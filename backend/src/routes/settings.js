const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");
const { FEATURES, FEATURE_KEYS } = require("../utils/features");
const { encryptField } = require("../utils/crypto");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");

// #271 Finding: general/logo settings only now -- GroupMe, WhatsApp,
// Email, Trips, and Dispatches settings each moved into their own sibling
// file (settingsGroupMe.js, settingsWhatsApp.js, settingsEmail.js,
// settingsTrips.js, settingsDispatches.js), all mounted at this same
// /api/settings prefix from server.js. This file had grown to cover all
// six sub-resources in one place -- same anti-pattern trips.js had, same
// fix.
const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The logo's bytes live in their own one-to-one table (ChurchSettingsLogo
// -- see schema.prisma), never selected by anything below; every response
// synthesizes this `{ url } | null` shape instead — the frontend just
// needs a fetchable URL, never the raw bytes inline. Presence is read off
// logoContentType (always set together with the bytes — see POST /logo
// below) rather than the bytes themselves, so checking "is there a logo"
// never requires fetching the image data at all.
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

// webp's Content-Type isn't always reliably reported by the uploading
// client -- confirmed directly (a plain multipart upload with no explicit
// Content-Type gets rejected even for a genuinely valid .webp file).
// Recognized by extension as a fallback, same approach HEIC/HEIF gets in
// routes/partners.js.
const resolveImageExt = makeExtResolver(IMAGE_MIME_TO_EXT, {
  test: (name) => /\.webp$/i.test(name),
  ext: "webp",
});

const upload = uploadFilteredBy(resolveImageExt, {
  maxFileSize: 5 * 1024 * 1024,
  message: "Only JPEG, PNG, or WebP images are allowed",
});

const settingsSchema = z.object({
  churchName: z.string().optional().nullable(),
  // #271 Finding 3: flat columns, not a nested address object -- matches
  // SendingParty's own flat address columns directly now.
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
  usePartnerTermInAdmin: z.boolean().optional(),
  publicTagline: z.string().optional().nullable(),
  aboutText: z.string().optional().nullable(),
  primaryColor: z.string().optional().nullable(),
  headerColor: z.string().optional().nullable(),
  highlightColor: z.string().optional().nullable(),
  brandFont: z.string().optional().nullable(),
  // Sets are normally via POST /logo (below), same as missionary/org
  // photos — this is here so PUT can also clear it (form sets logo: null).
  logo: z.any().optional().nullable(),
  // Same whole-object-replace semantics as every other field here -- the
  // frontend always PUTs its complete current map, not just the one key
  // that changed (see AdminChurchSettings.jsx's mergeFetchedRecord).
  // partialRecord (not record) -- a plain z.record(z.enum(...), ...) in Zod
  // 4 requires every enum key present, rejecting a sparse map like
  // { aiExtraction: true } with the other three keys just absent.
  enabledFeatures: z.partialRecord(z.enum(FEATURE_KEYS), z.boolean()).optional(),
  // See the field's comment in schema.prisma -- a deliberate, permanent
  // opt-out of BackupReminder.jsx, distinct from that component's own
  // dismiss-for-30-days.
  backupReminderDisabled: z.boolean().optional(),
  // This church's own IANA timezone -- see the field's own comment in
  // schema.prisma for why this exists and what it drives. Validated
  // against the real, current list of valid zone names (the same list
  // AdminSettingsAbout.jsx's <select> is populated from via
  // Intl.supportedValuesOf("timeZone")) rather than just "any non-empty
  // string" -- a typo'd zone would otherwise silently fall back to UTC
  // at server startup with no feedback to anyone.
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Not a valid IANA timezone")
    .optional(),
});

// GET /api/settings (any logged-in role) — null if never configured yet.
router.get("/", async (req, res, next) => {
  try {
    const [settings, sentByOurChurchCount] = await Promise.all([
      prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        omit: {
          groupmeAccessToken: true,
          whatsappPhoneNumber: true,
          joshuaProjectApiKey: true,
          anthropicApiKey: true,
          postmarkServerToken: true,
          inboundEmailWebhookPassword: true,
        },
      }),
      // Backs the bulk "Sync from Church Settings" action on the About
      // Church page (AdminSettingsAbout.jsx) -- cheap enough to include on
      // every settings fetch rather than a dedicated endpoint.
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
    }));
    res.json({ ...shapeSettings(settings), featureRegistry, sentByOurChurchCount });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings (admin only — site-wide config, same blast radius as
// user management, not per-record data like a missionary edit).
router.put("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { logo, ...data } = settingsSchema.partial().parse(req.body);
    // `logo` isn't a real column (see schema.prisma) — the only thing the
    // frontend ever sends it as is `null`, to clear an existing logo (a
    // set goes through POST /logo below instead). Anything else about it
    // in the request is ignored, same as before this was split into two
    // columns. The bytes row itself is deleted via a plain deleteMany --
    // a no-op if there was never a logo set, unlike a nested `delete`,
    // which throws if the related row doesn't already exist.
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
    // Verified against the canonical type for the resolved extension, not
    // req.file.mimetype directly -- same reasoning as the HEIC photo
    // upload in routes/partners.js: a browser's own reported Content-Type
    // for this file isn't always trustworthy, and the signature check
    // needs to know what it's actually supposed to be. Also what actually
    // gets stored, so GET /logo/raw later serves the correct header
    // regardless of what the upload itself claimed.
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

// A write-only "one API key, admin-only, GET returns { configured }"
// settings sub-resource -- the exact same shape Joshua Project and AI
// Request Scanning each need below, differing only in which ChurchSettings
// column holds the key (see #135). Registers GET/PUT /api/settings/:path
// on this router. GroupMe (settingsGroupMe.js) stays hand-written -- it
// has several fields (token, group, three topic ids), not one key, so
// this shape doesn't fit it.
function registerApiKeySetting(path, field) {
  const select = { [field]: true };
  function shape(settings) {
    return { configured: Boolean(settings?.[field]) };
  }
  const schema = z.object({
    // Omitted/blank leaves the stored key untouched -- same write-only-field
    // UX as settingsGroupMe.js's own accessToken.
    apiKey: z.string().trim().min(1).optional(),
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
      const { apiKey } = schema.parse(req.body);
      const fields = apiKey ? { [field]: encryptField(apiKey) } : {};

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
registerApiKeySetting("ai-extraction", "anthropicApiKey");

module.exports = router;
