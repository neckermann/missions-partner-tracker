const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { matchesFileSignature } = require("../utils/fileSignature");
const { FEATURES, FEATURE_KEYS, isFeatureEnabled } = require("../utils/features");
const { encryptField, decryptField } = require("../utils/crypto");
const { listGroups, listTopics } = require("../utils/groupmeChannel");
const whatsappClient = require("../utils/whatsappClient");
const rateLimit = require("express-rate-limit");
const { sendEmail } = require("../utils/email");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The logo's bytes live right on this row (logoBytes/logoContentType —
// see the comment on that field in schema.prisma) but every query below
// omits logoBytes and every response synthesizes this `{ url } | null`
// shape instead — the frontend just needs a fetchable URL, never the raw
// bytes inline. Presence is read off logoContentType (always set
// together with logoBytes — see POST /logo below) rather than
// logoBytes itself, so checking "is there a logo" never requires
// fetching the image data at all.
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

const addressSchema = z
  .object({
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    stateProvinceRegion: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
  })
  .optional()
  .nullable();

const settingsSchema = z.object({
  churchName: z.string().optional().nullable(),
  address: addressSchema,
  phone: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
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
          logoBytes: true,
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
    // columns.
    const clearLogo = logo === null ? { logoBytes: null, logoContentType: null } : {};

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, ...clearLogo, updatedById: req.user.id },
      update: { ...data, ...clearLogo, updatedById: req.user.id },
      omit: {
        logoBytes: true,
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
        logoBytes: req.file.buffer,
        logoContentType: signatureMime,
        updatedById: req.user.id,
      },
      update: { logoBytes: req.file.buffer, logoContentType: signatureMime, updatedById: req.user.id },
      omit: {
        logoBytes: true,
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

const groupmeSettingsSelect = {
  groupmeAccessToken: true,
  groupmeGroupId: true,
  groupmeGroupName: true,
  groupmePrayerTopicId: true,
  groupmePrayerTopicName: true,
  groupmeOneTimeNeedTopicId: true,
  groupmeOneTimeNeedTopicName: true,
  groupmeNewsletterTopicId: true,
  groupmeNewsletterTopicName: true,
};
function shapeGroupMeSettings(settings) {
  return {
    configured: Boolean(settings?.groupmeAccessToken),
    groupId: settings?.groupmeGroupId || null,
    groupName: settings?.groupmeGroupName || null,
    prayerTopicId: settings?.groupmePrayerTopicId || null,
    prayerTopicName: settings?.groupmePrayerTopicName || null,
    oneTimeNeedTopicId: settings?.groupmeOneTimeNeedTopicId || null,
    oneTimeNeedTopicName: settings?.groupmeOneTimeNeedTopicName || null,
    newsletterTopicId: settings?.groupmeNewsletterTopicId || null,
    newsletterTopicName: settings?.groupmeNewsletterTopicName || null,
  };
}

const groupmeSchema = z.object({
  // Omitted/blank leaves the stored token untouched -- the same
  // write-only-field UX as a password-change form, since there is no
  // "current value" to show back and nothing to merge it against.
  accessToken: z.string().trim().min(1).optional(),
  // Set together from the admin's picks in the live GET /groupme/groups
  // and GET /groupme/groups/:id/topics lists below, never hand-typed.
  groupId: z.string().trim().optional().nullable(),
  groupName: z.string().trim().optional().nullable(),
  prayerTopicId: z.string().trim().optional().nullable(),
  prayerTopicName: z.string().trim().optional().nullable(),
  oneTimeNeedTopicId: z.string().trim().optional().nullable(),
  oneTimeNeedTopicName: z.string().trim().optional().nullable(),
  newsletterTopicId: z.string().trim().optional().nullable(),
  newsletterTopicName: z.string().trim().optional().nullable(),
});

// GET /api/settings/groupme (admin only -- not folded into GET /, which
// any logged-in role can read; this entire feature stays behind the
// admin gate, not just its writes).
router.get("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: groupmeSettingsSelect,
    });
    res.json(shapeGroupMeSettings(settings));
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/groupme (admin only) -- a plain partial update, same
// shape as PUT / above: the frontend sends whichever fields it's
// changing (just accessToken when first connecting; groupId/groupName
// once a group's picked; *TopicId/*TopicName once a topic is, one
// notification type at a time).
router.put("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const {
      accessToken,
      groupId,
      groupName,
      prayerTopicId,
      prayerTopicName,
      oneTimeNeedTopicId,
      oneTimeNeedTopicName,
      newsletterTopicId,
      newsletterTopicName,
    } = groupmeSchema.parse(req.body);
    const fields = {
      groupmeGroupId: groupId,
      groupmeGroupName: groupName,
      groupmePrayerTopicId: prayerTopicId,
      groupmePrayerTopicName: prayerTopicName,
      groupmeOneTimeNeedTopicId: oneTimeNeedTopicId,
      groupmeOneTimeNeedTopicName: oneTimeNeedTopicName,
      groupmeNewsletterTopicId: newsletterTopicId,
      groupmeNewsletterTopicName: newsletterTopicName,
    };
    if (accessToken) fields.groupmeAccessToken = encryptField(accessToken);

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...fields, updatedById: req.user.id },
      update: { ...fields, updatedById: req.user.id },
      select: groupmeSettingsSelect,
    });
    res.json(shapeGroupMeSettings(updated));
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/groupme/groups (admin only) -- the admin's own
// GroupMe groups, for the "which group" picker. Requires a token to
// already be saved; this app only ever lists, never creates.
router.get("/groupme/groups", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    if (!settings?.groupmeAccessToken) {
      return res.status(400).json({ error: "Save a GroupMe access token first" });
    }
    try {
      res.json(await listGroups(decryptField(settings.groupmeAccessToken)));
    } catch (err) {
      // A GroupMe-side failure (bad token, GroupMe down) is routine here
      // -- this is exactly the call an admin makes to find out their
      // token doesn't work. The generic error handler collapses
      // unexpected errors to "Server error" on purpose (see
      // middleware/errors.js); groupmeRequest's own message is already
      // safe to show, so it's surfaced directly instead of being lost.
      res.status(502).json({ error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/groupme/groups/:groupId/topics (admin only) -- that
// group's Topics, for the "which topic" picker.
router.get("/groupme/groups/:groupId/topics", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    if (!settings?.groupmeAccessToken) {
      return res.status(400).json({ error: "Save a GroupMe access token first" });
    }
    try {
      res.json(await listTopics(decryptField(settings.groupmeAccessToken), req.params.groupId));
    } catch (err) {
      // See the matching comment on GET /groupme/groups above.
      res.status(502).json({ error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

// WhatsApp -- the sibling of the GroupMe routes above. Everything here is
// admin-only AND behind the `whatsapp` feature (a disabled feature looks
// like it doesn't exist -- 404 -- same as every other gated route), so a
// church that never turns WhatsApp on exposes none of this. There is no
// token to save: the credential is a Baileys session that lives encrypted
// in the WhatsAppAuthEntry table and is never read back through any route
// (only a status derived from the live socket is). Community and group
// ids are always picked from live lists, never hand-typed.
const whatsappSettingsSelect = {
  whatsappPhoneNumber: true,
  whatsappPairedAt: true,
  whatsappCommunityId: true,
  whatsappCommunityName: true,
  whatsappAnnouncementGroupId: true,
  whatsappAnnouncementGroupName: true,
  whatsappPrayerGroupId: true,
  whatsappPrayerGroupName: true,
  whatsappOneTimeNeedGroupId: true,
  whatsappOneTimeNeedGroupName: true,
  whatsappNewsletterGroupId: true,
  whatsappNewsletterGroupName: true,
};
function shapeWhatsAppSettings(settings) {
  const { status, health, error } = whatsappClient.getStatus();
  return {
    paired: Boolean(settings?.whatsappPairedAt),
    pairedAt: settings?.whatsappPairedAt || null,
    phoneNumber: settings?.whatsappPhoneNumber || null,
    communityId: settings?.whatsappCommunityId || null,
    communityName: settings?.whatsappCommunityName || null,
    announcementGroupId: settings?.whatsappAnnouncementGroupId || null,
    announcementGroupName: settings?.whatsappAnnouncementGroupName || null,
    prayerGroupId: settings?.whatsappPrayerGroupId || null,
    prayerGroupName: settings?.whatsappPrayerGroupName || null,
    oneTimeNeedGroupId: settings?.whatsappOneTimeNeedGroupId || null,
    oneTimeNeedGroupName: settings?.whatsappOneTimeNeedGroupName || null,
    newsletterGroupId: settings?.whatsappNewsletterGroupId || null,
    newsletterGroupName: settings?.whatsappNewsletterGroupName || null,
    connection: { status, health, error },
  };
}

const whatsappJid = z
  .string()
  .trim()
  .regex(/^[\w.-]+@g\.us$/, "Not a WhatsApp group id")
  .nullable()
  .optional();
const whatsappLabel = z.string().trim().max(200).nullable().optional();
const whatsappSchema = z.object({
  communityId: whatsappJid,
  communityName: whatsappLabel,
  prayerGroupId: whatsappJid,
  prayerGroupName: whatsappLabel,
  oneTimeNeedGroupId: whatsappJid,
  oneTimeNeedGroupName: whatsappLabel,
  newsletterGroupId: whatsappJid,
  newsletterGroupName: whatsappLabel,
});

// Anyone who scans a live QR code links their phone to this app's
// session, so pairing starts are throttled; the status poll is not (it's
// polled every couple of seconds while the pairing screen is open).
const whatsappPairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const whatsappGate = [requireFeature("whatsapp"), requireRole("admin")];

router.get("/whatsapp", ...whatsappGate, async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    res.set("Cache-Control", "no-store");
    res.json(shapeWhatsAppSettings(settings));
  } catch (err) {
    next(err);
  }
});

// A plain partial update, like PUT /groupme: the frontend sends whichever
// fields it's changing. Picking a different community clears the three
// group picks (they belonged to the old one) unless the same request sets
// them again.
router.put("/whatsapp", ...whatsappGate, async (req, res, next) => {
  try {
    const body = whatsappSchema.parse(req.body);
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    const communityChanged =
      body.communityId !== undefined && body.communityId !== (current?.whatsappCommunityId ?? null);
    const groupPick = (id, name) =>
      communityChanged ? { id: id ?? null, name: name ?? null } : { id, name };
    const prayer = groupPick(body.prayerGroupId, body.prayerGroupName);
    const needs = groupPick(body.oneTimeNeedGroupId, body.oneTimeNeedGroupName);
    const newsletter = groupPick(body.newsletterGroupId, body.newsletterGroupName);

    // The Announcements group is auto-resolved, never hand-picked (see
    // whatsappClient.js's findAnnouncementGroup) -- when the community
    // changes, re-resolve it from the new one instead of just clearing
    // it like the three explicit picks above. Best-effort: a momentary
    // disconnect here must not block saving the community pick itself --
    // leave it null and the admin can tell from the page that none was
    // detected, same resilience as every other live-socket call in this
    // file.
    let announcement = {
      id: current?.whatsappAnnouncementGroupId ?? null,
      name: current?.whatsappAnnouncementGroupName ?? null,
    };
    if (communityChanged) {
      announcement = { id: null, name: null };
      if (body.communityId) {
        try {
          const found = await whatsappClient.findAnnouncementGroup(body.communityId);
          if (found) announcement = { id: found.id, name: found.name };
        } catch {
          // left null -- see comment above.
        }
      }
    }

    const fields = {
      whatsappCommunityId: body.communityId,
      whatsappCommunityName: body.communityName,
      whatsappAnnouncementGroupId: announcement.id,
      whatsappAnnouncementGroupName: announcement.name,
      whatsappPrayerGroupId: prayer.id,
      whatsappPrayerGroupName: prayer.name,
      whatsappOneTimeNeedGroupId: needs.id,
      whatsappOneTimeNeedGroupName: needs.name,
      whatsappNewsletterGroupId: newsletter.id,
      whatsappNewsletterGroupName: newsletter.name,
    };
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...fields, updatedById: req.user.id },
      update: { ...fields, updatedById: req.user.id },
      select: whatsappSettingsSelect,
    });
    res.json(shapeWhatsAppSettings(updated));
  } catch (err) {
    next(err);
  }
});

// Starts pairing; the QR is read back from /whatsapp/pair/status.
router.post("/whatsapp/pair", whatsappPairLimiter, ...whatsappGate, async (req, res, next) => {
  try {
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { whatsappPairedAt: true },
    });
    if (current?.whatsappPairedAt) {
      return res.status(409).json({ error: "A WhatsApp number is already linked. Unlink it first." });
    }
    try {
      await whatsappClient.startPairing();
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    res.set("Cache-Control", "no-store");
    res.json({ started: true });
  } catch (err) {
    next(err);
  }
});

// Polled while the pairing screen is open. no-store: this carries a live
// QR code / pairing code, which must never sit in a cache.
router.get("/whatsapp/pair/status", ...whatsappGate, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(whatsappClient.getStatus());
});

router.get("/whatsapp/communities", ...whatsappGate, async (req, res) => {
  try {
    res.json(await whatsappClient.listCommunities());
  } catch (err) {
    // A WhatsApp-side failure (not connected, rate limited) is routine
    // here -- see the matching comment on GET /groupme/groups.
    res.status(502).json({ error: err.message });
  }
});

router.get("/whatsapp/communities/:communityId/groups", ...whatsappGate, async (req, res) => {
  try {
    res.json(await whatsappClient.listCommunityGroups(req.params.communityId));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Unlinks the number for good: WhatsApp drops the linked device, the
// stored session is wiped, and the saved community/group picks are
// cleared (they belonged to that number's memberships).
router.post("/whatsapp/unlink", ...whatsappGate, async (req, res, next) => {
  try {
    await whatsappClient.unlink();
    const updated = await prisma.churchSettings.updateMany({
      where: { id: "singleton" },
      data: {
        whatsappCommunityId: null,
        whatsappCommunityName: null,
        whatsappAnnouncementGroupId: null,
        whatsappAnnouncementGroupName: null,
        whatsappPrayerGroupId: null,
        whatsappPrayerGroupName: null,
        whatsappOneTimeNeedGroupId: null,
        whatsappOneTimeNeedGroupName: null,
        whatsappNewsletterGroupId: null,
        whatsappNewsletterGroupName: null,
      },
    });
    void updated;
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    res.json(shapeWhatsAppSettings(settings));
  } catch (err) {
    next(err);
  }
});

// Outbound (#71) and inbound (#72) share one Postmark account and one
// settings page, but are gated by two independent feature flags -- see
// the comment on these two keys in utils/features.js for why. GET/PUT
// here must be reachable if EITHER is on (an admin configuring only
// inbound must not be blocked by outbound being off, and vice versa),
// so this uses requireFeature's array form (any-of) rather than a single
// key -- same mechanism the public directory/map pair already uses for
// the same "reachable if at least one of these is on" reasoning. The
// two feature-specific routes below (POST /email/test,
// routes/inboundEmail.js's webhook + queue routes) still check their own
// single flag, which is what actually keeps the two directions
// independent -- this shared page is just a convenience, not a new
// source of truth.
const emailSettingsSelect = {
  postmarkServerToken: true,
  emailFromAddress: true,
  inboundEmailWebhookUsername: true,
  inboundEmailWebhookPassword: true,
  inboundEmailAddress: true,
  enabledFeatures: true,
};

function shapeEmailSettings(settings) {
  return {
    sendEnabled: isFeatureEnabled(settings?.enabledFeatures, "outboundEmail"),
    outboundConfigured: Boolean(settings?.postmarkServerToken && settings?.emailFromAddress),
    fromAddress: settings?.emailFromAddress || null,
    receiveEnabled: isFeatureEnabled(settings?.enabledFeatures, "inboundEmail"),
    inboundConfigured: Boolean(
      settings?.inboundEmailWebhookUsername && settings?.inboundEmailWebhookPassword
    ),
    // Purely informational (#252) -- the address partners/participants
    // were told, outside this app, to send mail to. Not involved in
    // routing the webhook itself.
    inboundEmailAddress: settings?.inboundEmailAddress || null,
    // The username alone is meaningless without the password (see the
    // schema.prisma comment), so it's safe to echo back -- useful for an
    // admin to confirm what they set without re-typing it. webhookPath is
    // static, not a DB value -- the admin builds the full Basic-Auth URL
    // themselves in Postmark's own UI from this path plus the username/
    // password they chose, never a pre-built credential-bearing URL
    // rendered here (see #72's plan for why).
    webhookUsername: settings?.inboundEmailWebhookUsername || null,
    webhookPath: "/api/inbound-email/postmark",
  };
}

const emailSchema = z.object({
  // Omitted/blank leaves the stored value untouched -- same write-only-
  // field UX as groupme's accessToken above, now for four independent
  // credential fields plus the two enable toggles.
  sendEnabled: z.boolean().optional(),
  serverToken: z.string().trim().min(1).optional(),
  fromAddress: z.string().trim().email().optional().nullable(),
  receiveEnabled: z.boolean().optional(),
  webhookUsername: z.string().trim().min(1).optional(),
  webhookPassword: z.string().trim().min(1).optional(),
  // Plain text, not a secret -- the address partners send mail to (#252).
  inboundEmailAddress: z.string().trim().email().optional().nullable(),
});

// GET /api/settings/email -- unlike GroupMe/Joshua Project/AI Extraction
// (whose settings stay reachable while off, so an admin can configure
// them before flipping the switch), Email's settings route is gated the
// same way a real content feature's routes are (see
// routes/partnerFiles.js's router.use(requireFeature(...))) -- off means
// genuinely not reachable, not just hidden from nav. A church with
// neither direction on yet turns one on first from Enabled Features
// (which is never gated), then this page becomes reachable to configure
// it (and, from here, optionally also turn the other direction on).
router.get(
  "/email",
  requireFeature(["outboundEmail", "inboundEmail"]),
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: emailSettingsSelect,
      });
      res.json(shapeEmailSettings(settings));
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/settings/email -- see the same gating comment on GET above.
router.put(
  "/email",
  requireFeature(["outboundEmail", "inboundEmail"]),
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const {
        sendEnabled,
        serverToken,
        fromAddress,
        receiveEnabled,
        webhookUsername,
        webhookPassword,
        inboundEmailAddress,
      } = emailSchema.parse(req.body);

      const fields = {};
      if (serverToken) fields.postmarkServerToken = encryptField(serverToken);
      if (fromAddress !== undefined) fields.emailFromAddress = fromAddress;
      if (webhookUsername) fields.inboundEmailWebhookUsername = webhookUsername;
      if (webhookPassword) fields.inboundEmailWebhookPassword = encryptField(webhookPassword);
      if (inboundEmailAddress !== undefined) fields.inboundEmailAddress = inboundEmailAddress;

      // enabledFeatures is one JSON blob shared with every other
      // integration's own flag (GroupMe, Joshua Project, ...) and with
      // the Enabled Features page itself -- Prisma has no partial-JSON
      // update, so this reads the current blob and merges just these two
      // keys onto it rather than replacing the whole thing.
      if (sendEnabled !== undefined || receiveEnabled !== undefined) {
        const current = await prisma.churchSettings.findUnique({
          where: { id: "singleton" },
          select: { enabledFeatures: true },
        });
        fields.enabledFeatures = {
          ...(current?.enabledFeatures || {}),
          ...(sendEnabled !== undefined ? { outboundEmail: sendEnabled } : {}),
          ...(receiveEnabled !== undefined ? { inboundEmail: receiveEnabled } : {}),
        };
      }

      const updated = await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...fields, updatedById: req.user.id },
        update: { ...fields, updatedById: req.user.id },
        select: emailSettingsSelect,
      });
      res.json(shapeEmailSettings(updated));
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/settings/email/test -- outbound-specific, so this checks
// "outboundEmail" alone (not the any-of gate above) -- sending must stay
// blocked if only inbound is on. Sends a real email to the caller's own
// account address, so a bad token/from-address is caught here rather
// than at the first real send.
router.post("/email/test", requireFeature("outboundEmail"), requireRole("admin"), async (req, res, next) => {
  try {
    await sendEmail({
      to: req.user.email,
      subject: "Test email from missions-partner-tracker",
      text: "If you're reading this, your email settings are working.",
    });
    res.json({ sent: true });
  } catch (err) {
    // A bad token/from-address/Postmark-side failure is routine here --
    // this is exactly the call an admin makes to find out their settings
    // don't work. Same reasoning as GroupMe's live-check routes above.
    res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
  }
});

// Trips (#252) -- church-wide settings for the whole feature area: the
// donation-instructions fields (§13), the donor-contact opt-in (§6), and
// the two private-link gates (§4/§6). Gated by requireFeature("trips")
// alone -- reachable to configure as soon as the backend feature is on,
// same posture GroupMe/Joshua Project settings already take (configurable
// before the more specific public-facing bits are turned on).
const tripsSettingsSelect = {
  onlineGivingUrl: true,
  onlineGivingInstructions: true,
  collectDonorContactInfo: true,
  allowPrivateApplicationLinks: true,
  allowPublicFundraisingLinks: true,
};

const tripsSettingsSchema = z.object({
  onlineGivingUrl: z.string().trim().optional().nullable(),
  onlineGivingInstructions: z.string().optional().nullable(),
  collectDonorContactInfo: z.boolean().optional(),
  allowPrivateApplicationLinks: z.boolean().optional(),
  allowPublicFundraisingLinks: z.boolean().optional(),
});

router.get("/trips", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: tripsSettingsSelect,
    });
    res.json(
      settings || {
        onlineGivingUrl: null,
        onlineGivingInstructions: null,
        collectDonorContactInfo: false,
        allowPrivateApplicationLinks: false,
        allowPublicFundraisingLinks: false,
      }
    );
  } catch (err) {
    next(err);
  }
});

router.put("/trips", requireFeature("trips"), requireRole("admin"), async (req, res, next) => {
  try {
    const data = tripsSettingsSchema.parse(req.body);
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: tripsSettingsSelect,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Notifications -- the admin/public email digest's own schedule
// (biweekly/monthly/quarterly), GroupMe's own daily-hour schedule,
// GroupMe's three content-type mutes, the one cross-channel restricted-
// partner safety gate, and email dispatch customization -- all
// admin-only church-wide config, same shape of settings sub-resource as
// GroupMe/Email above (not gated by requireFeature -- this page is
// useful to configure regardless of which channel(s) happen to be on,
// same reasoning Enabled Features itself is never gated). The old
// church-wide digestFrequency/digestDayOfWeek/digestDayOfMonth/digestHour
// mechanism is retired entirely (see schema.prisma's own comment on
// what replaced it) -- nothing here reads or writes those columns
// anymore. The pending queue and the manual review flow live in
// routes/dispatches.js, not here -- this is just the configuration half.
const dispatchSettingsSelect = {
  chatDispatchPrayerRequests: true,
  chatDispatchOneTimeNeeds: true,
  chatDispatchNewsletters: true,
  allowRestrictedPartnerDispatch: true,
  emailDispatchSubjectTemplate: true,
  emailDispatchSignature: true,
  emailDispatchLayout: true,
  // The admin/public email dispatch's own schedule -- three cadence
  // tiers (biweekly/monthly/quarterly). Without these ever being set,
  // dispatchOrchestrator.js's clearDispatchRecords() treats every
  // tier as unscheduled and emailDispatchScheduler.js's three gate checks never
  // fire -- see those files' own comments.
  emailDispatchDayOfWeek: true,
  emailDispatchDayOfMonth: true,
  emailDispatchHour: true,
  // GroupMe/WhatsApp's own, independent daily-hour chat schedule -- see
  // groupmeChannel.js's shouldFlushGroupMe and the field's own
  // schema.prisma comment for why this isn't a tier pick like the three
  // above.
  chatDispatchHour: true,
};

const dispatchSettingsSchema = z.object({
  chatDispatchPrayerRequests: z.boolean().optional(),
  chatDispatchOneTimeNeeds: z.boolean().optional(),
  chatDispatchNewsletters: z.boolean().optional(),
  allowRestrictedPartnerDispatch: z.boolean().optional(),
  emailDispatchSubjectTemplate: z.string().optional().nullable(),
  emailDispatchSignature: z.string().optional().nullable(),
  emailDispatchLayout: z.enum(["classic", "snapshot"]).optional().nullable(),
  emailDispatchDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  emailDispatchDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  emailDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
  chatDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
});

router.get("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: dispatchSettingsSelect,
    });
    res.json(
      settings || {
        chatDispatchPrayerRequests: true,
        chatDispatchOneTimeNeeds: true,
        chatDispatchNewsletters: true,
        allowRestrictedPartnerDispatch: false,
        emailDispatchSubjectTemplate: null,
        emailDispatchSignature: null,
        emailDispatchLayout: null,
        emailDispatchDayOfWeek: null,
        emailDispatchDayOfMonth: null,
        emailDispatchHour: null,
        chatDispatchHour: null,
      }
    );
  } catch (err) {
    next(err);
  }
});

router.put("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const data = dispatchSettingsSchema.parse(req.body);
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: dispatchSettingsSelect,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// A write-only "one API key, admin-only, GET returns { configured }"
// settings sub-resource -- the exact same shape Joshua Project and AI
// Request Scanning each need below, differing only in which ChurchSettings
// column holds the key (see #135). Registers GET/PUT /api/settings/:path
// on this router. GroupMe above stays hand-written -- it has several
// fields (token, group, three topic ids), not one key, so this shape
// doesn't fit it.
function registerApiKeySetting(path, field) {
  const select = { [field]: true };
  function shape(settings) {
    return { configured: Boolean(settings?.[field]) };
  }
  const schema = z.object({
    // Omitted/blank leaves the stored key untouched -- same write-only-field
    // UX as groupme's accessToken above.
    apiKey: z.string().trim().min(1).optional(),
  });

  // GET (admin only, same reasoning as GET /groupme above).
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
