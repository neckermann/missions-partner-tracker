const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");
const { FEATURES, FEATURE_KEYS } = require("../utils/features");
const { encryptField } = require("../utils/crypto");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const { isPasswordlessOn, passwordlessBlocker } = require("../utils/passwordless");
const { isDemoDeployment } = require("../utils/demoMode");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");

// General/logo settings. GroupMe, WhatsApp, Email, Trips and Dispatches settings live in sibling
// settings*.js files mounted at the same /api/settings prefix from server.js.
const { loadChurchLists } = require("../utils/tripTemplates");
const { KEY_DATE_LEAD_RANGE, CONTACT_STALE_RANGE } = require("../utils/careSettings");
const router = express.Router();
router.use(requireAuth);

// The logo's bytes live in their own table (ChurchSettingsLogo), never selected below; responses
// synthesize `{ url } | null`. Presence is read off logoContentType (always set with the bytes), so
// checking for a logo never fetches image data.
function shapeSettings(settings) {
  if (!settings) return settings;
  const { logoContentType, ...rest } = settings;
  return { ...rest, logo: logoContentType ? { url: "/api/public/settings/logo/raw" } : null };
}

const IMAGE_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// webp's Content-Type isn't reliably reported by uploading clients (a plain multipart upload gets
// rejected), so it is recognized by extension, as HEIC/HEIF in routes/partners.js.
const resolveImageExt = makeExtResolver(IMAGE_MIME_TO_EXT, {
  test: (name) => /\.webp$/i.test(name),
  ext: "webp",
});

const upload = uploadFilteredBy(resolveImageExt, {
  maxFileSize: 5 * 1024 * 1024,
  message: "Only JPEG, PNG, or WebP images are allowed",
});

// #327 Finding 11.4: these values land in `background-color:${...}` / `border-top:3px solid ${...}`
// style attributes in every email and confirm page (emailDispatchShell.js, subscriberPage.js,
// auth.js), so they must be strictly `#rrggbb` (all <input type="color"> emits) to prevent
// attribute/HTML/CSS injection.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function brandColorSchema() {
  return z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || HEX_COLOR_PATTERN.test(v), "Must be a #rrggbb hex color");
}

// Same injection risk for font-family, with no native input to constrain it: an explicit allowlist
// mirroring FONT_OPTIONS in AdminSettingsAbout.jsx. Keep the two in sync.
const BRAND_FONT_OPTIONS = new Set([
  "",
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Helvetica Neue", Arial, sans-serif',
  'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  '"Trebuchet MS", Verdana, sans-serif',
]);
const brandFontSchema = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || BRAND_FONT_OPTIONS.has(v), "Unsupported font");

const settingsSchema = z.object({
  churchName: z.string().optional().nullable(),
  // Flat columns, matching SendingParty's flat address columns.
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  contactFirstName: z.string().optional().nullable(),
  contactLastName: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  websiteLink: z.string().optional().nullable(),
  partnerTermSingular: z.string().optional().nullable(),
  partnerTermPlural: z.string().optional().nullable(),
  ownerGroupName: z.string().trim().max(60).optional().nullable(),
  usePartnerTermInAdmin: z.boolean().optional(),
  publicTagline: z.string().optional().nullable(),
  aboutText: z.string().optional().nullable(),
  primaryColor: brandColorSchema(),
  headerColor: brandColorSchema(),
  highlightColor: brandColorSchema(),
  brandFont: brandFontSchema,
  // Set via POST /logo; present here so PUT can also clear it (the form sends logo: null).
  logo: z.any().optional().nullable(),
  // Whole-object replace: the frontend PUTs its complete current map. partialRecord, not record: in
  // Zod 4 a plain z.record(z.enum(...)) requires every key, rejecting a sparse map like
  // { aiExtraction: true }.
  enabledFeatures: z.partialRecord(z.enum(FEATURE_KEYS), z.boolean()).optional(),
  // A deliberate, permanent opt-out of BackupReminder.jsx (see schema.prisma), distinct from its
  // 30-day dismiss.
  backupReminderDisabled: z.boolean().optional(),
  // Require two-factor for every account (#385); see the field's comment in schema.prisma.
  // Turning it on has guards in PUT / below.
  requireTwoFactor: z.boolean().optional(),
  requirePasswordless: z.boolean().optional(),
  // How far ahead a key date is raised, and how long without a logged contact makes a partner
  // "quiet" (#365); see utils/careSettings.js for the bounds.
  keyDateLeadDays: z.number().int().min(KEY_DATE_LEAD_RANGE.min).max(KEY_DATE_LEAD_RANGE.max).optional(),
  contactStaleDays: z.number().int().min(CONTACT_STALE_RANGE.min).max(CONTACT_STALE_RANGE.max).optional(),
  // This church's IANA timezone (see schema.prisma). Validated against Intl.supportedValuesOf(
  // "timeZone"), as AdminSettingsAbout.jsx's <select>, since a typo'd zone would silently fall back
  // to UTC at startup.
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Not a valid IANA timezone")
    .optional(),
});

// GET /api/settings (any logged-in role) — null if never configured yet.
router.get("/", async (req, res, next) => {
  try {
    const [settings, sentByOurChurchCount] = await Promise.all([
      // #327 Finding 9: explicit `select`, not an `omit` denylist, so a newly added secret column is never
      // exposed to every signed-in role (Trip Leader included) by default. Deliberately excluded: the
      // original secrets, inboundEmailWebhookUsername (half the webhook credential), GroupMe/WhatsApp
      // internals and inboundEmailAddress (served by their own admin routes), scheduler timestamps and
      // updatedById.
      prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: {
          id: true,
          churchName: true,
          aboutText: true,
          publicTagline: true,
          partnerTermSingular: true,
          partnerTermPlural: true,
          ownerGroupName: true,
          usePartnerTermInAdmin: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          stateProvinceRegion: true,
          postalCode: true,
          country: true,
          phone: true,
          websiteLink: true,
          contactFirstName: true,
          contactLastName: true,
          contactEmail: true,
          timezone: true,
          brandFont: true,
          headerColor: true,
          highlightColor: true,
          primaryColor: true,
          logoContentType: true,
          enabledFeatures: true,
          // Church policy booleans, already visible to everyone as `twoFactorRequired` on
          // /api/auth/me (#402).
          requireTwoFactor: true,
          requirePasswordless: true,
          keyDateLeadDays: true,
          contactStaleDays: true,
          extractionModel: true,
          allowRestrictedPartnerDispatch: true,
          backupReminderDisabled: true,
          onlineGivingUrl: true,
          onlineGivingInstructions: true,
          collectDonorContactInfo: true,
          collectApplicantAddress: true,
          collectEmergencyContact: true,
          allowPrivateApplicationLinks: true,
          allowPublicSupportRaisingLinks: true,
          enableTripBudgeting: true,
          cadenceBiweeklyEnabled: true,
          cadenceMonthlyEnabled: true,
          cadenceQuarterlyEnabled: true,
          emailDispatchDayOfWeek: true,
          emailDispatchDayOfMonth: true,
          emailDispatchHour: true,
          emailDispatchSubjectTemplate: true,
          emailDispatchSignature: true,
          emailDispatchLayout: true,
          emailFromAddress: true,
          chatDispatchHour: true,
          chatDispatchPrayerRequests: true,
          chatDispatchOneTimeNeeds: true,
          chatDispatchNewsletters: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      // Backs the bulk "Sync from Church Settings" action (AdminSettingsAbout.jsx).
      prisma.partner.count({ where: { sentByOurChurch: true } }),
    ]);
    // Registry metadata (label/description) travels with the response
    // instead of being duplicated in the frontend.
    const featureRegistry = FEATURE_KEYS.map((key) => ({
      key,
      label: FEATURES[key].label,
      description: FEATURES[key].description,
      defaultEnabled: FEATURES[key].defaultEnabled,
      group: FEATURES[key].group,
      section: FEATURES[key].section,
      requires: FEATURES[key].requires || [],
      setupNeeds: FEATURES[key].setupNeeds || [],
      withoutEmail: FEATURES[key].withoutEmail || null,
    }));
    res.json({
      ...shapeSettings(settings),
      ...(settings ? await loadChurchLists() : {}),
      featureRegistry,
      sentByOurChurchCount,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings (admin only — site-wide config, same blast radius as
// user management, not per-record data like a missionary edit).
router.put("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { logo, ...data } = settingsSchema.partial().parse(req.body);
    // Turning the two-factor requirement ON (#385). A save that merely resends it as already
    // on is not a change and is left alone.
    if (data.requireTwoFactor === true && !(await isTwoFactorRequired())) {
      // A public demo shares its logins and can't enrol an authenticator: requiring it would
      // lock every visitor out.
      if (isDemoDeployment()) {
        return res.status(400).json({ error: "Two-factor can't be required on the public demo" });
      }
      // The person turning it on must already have it, or the next request locks them out.
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { mfaEnabled: true } });
      if (!me?.mfaEnabled) {
        return res.status(400).json({
          error:
            "Set up two-factor on your own account first (My account), so turning this on doesn't lock you out",
        });
      }
    }
    // Turning passwordless sign-in ON (#386 Layer 2): email must work (people without a passkey
    // sign in through an emailed link) and the admin doing it must have a passkey.
    if (data.requirePasswordless === true && !(await isPasswordlessOn())) {
      const blocker = await passwordlessBlocker(req.user.id);
      if (blocker) return res.status(400).json({ error: blocker });
    }
    // ...and while it is on, outbound email can't be switched off: nobody without a passkey could
    // sign in, and nobody could be recovered.
    if (data.enabledFeatures?.outboundEmail === false && (await isPasswordlessOn())) {
      return res.status(400).json({
        error: "Outbound email can't be turned off while passwordless sign-in is on: turn that off first",
      });
    }
    // `logo` isn't a real column (see schema.prisma); the frontend sends only `null`, to clear it (a
    // set goes through POST /logo). The bytes row is removed via deleteMany, a no-op when absent,
    // unlike a nested `delete`, which throws.
    if (logo === null) {
      await prisma.churchSettingsLogo.deleteMany({ where: { id: "singleton" } });
    }
    const clearLogo = logo === null ? { logoContentType: null } : {};

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, ...clearLogo, updatedById: req.user.id },
      update: { ...data, ...clearLogo, updatedById: req.user.id },
      omit: {
        groupmeAccessToken: true,
        whatsappPhoneNumber: true,
        joshuaProjectApiKey: true,
        anthropicApiKey: true,
        postmarkServerToken: true,
        inboundEmailWebhookPassword: true,
      },
    });
    res.json(shapeSettings(updated));
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/logo (admin only)
router.post("/logo", requireRole("admin"), upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image file provided" });

    const ext = resolveImageExt(req.file);
    // Verified against the canonical type for the resolved extension, not req.file.mimetype (browsers'
    // Content-Type is unreliable, as with HEIC in partners.js). Also what is stored, so GET /logo/raw
    // serves the right header.
    const signatureMime = ext === "webp" ? "image/webp" : req.file.mimetype;
    if (!matchesFileSignature(req.file.buffer, signatureMime)) {
      return res.status(400).json({ error: "File content doesn't match its declared image type" });
    }

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        logoContentType: signatureMime,
        updatedById: req.user.id,
        logoRow: { create: { logoBytes: req.file.buffer } },
      },
      update: {
        logoContentType: signatureMime,
        updatedById: req.user.id,
        logoRow: {
          upsert: {
            create: { logoBytes: req.file.buffer },
            update: { logoBytes: req.file.buffer },
          },
        },
      },
      omit: {
        groupmeAccessToken: true,
        whatsappPhoneNumber: true,
        joshuaProjectApiKey: true,
        anthropicApiKey: true,
        postmarkServerToken: true,
        inboundEmailWebhookPassword: true,
      },
    });

    res.json(shapeSettings(updated));
  } catch (err) {
    next(err);
  }
});

// A write-only "one API key, admin-only, GET returns { configured }" sub-resource, as Joshua Project
// and AI Request Scanning need, differing only in which ChurchSettings column holds the key.
// Registers GET/PUT /api/settings/:path. GroupMe (settingsGroupMe.js) stays hand-written: it has
// several fields.
//
// `textField` (optional) adds one plain, non-secret companion field (AI Request Scanning's model
// id). Unlike the key it is never write-only: GET echoes it under `textField.key`, and PUT updates
// it whenever that key is present in the body (explicit null/"" clears it to the app default),
// independent of `apiKey`.
function registerApiKeySetting(path, field, textField) {
  const select = { [field]: true, ...(textField ? { [textField.column]: true } : {}) };
  function shape(settings) {
    const result = { configured: Boolean(settings?.[field]) };
    if (textField) result[textField.key] = settings?.[textField.column] ?? null;
    return result;
  }
  const schema = z.object({
    // Omitted/blank leaves the stored key untouched (write-only, as settingsGroupMe.js's accessToken).
    apiKey: z.string().trim().min(1).optional(),
    ...(textField ? { [textField.key]: z.string().trim().optional().nullable() } : {}),
  });

  // GET (admin only, same reasoning as GET /groupme in settingsGroupMe.js).
  router.get(`/${path}`, requireRole("admin"), async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select });
      res.json(shape(settings));
    } catch (err) {
      next(err);
    }
  });

  // PUT (admin only).
  router.put(`/${path}`, requireRole("admin"), async (req, res, next) => {
    try {
      const body = schema.parse(req.body);
      const fields = body.apiKey ? { [field]: encryptField(body.apiKey) } : {};
      // Checked against the raw body: once declared on the schema the key is present (as undefined)
      // either way, so this is the only way to tell "untouched" from "cleared" (blank/null -> store null).
      if (textField && textField.key in req.body) {
        fields[textField.column] = body[textField.key]?.trim() || null;
      }

      const updated = await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...fields, updatedById: req.user.id },
        update: { ...fields, updatedById: req.user.id },
        select,
      });
      res.json(shape(updated));
    } catch (err) {
      next(err);
    }
  });
}

registerApiKeySetting("joshua-project", "joshuaProjectApiKey");
// `model` (ChurchSettings.extractionModel) rides alongside the write-only anthropicApiKey; plain
// text, not encrypted (see schema.prisma).
registerApiKeySetting("ai-extraction", "anthropicApiKey", { key: "model", column: "extractionModel" });

module.exports = router;
