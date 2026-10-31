const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");
const { FEATURES, FEATURE_KEYS } = require("../utils/features");
const { encryptField, decryptField } = require("../utils/crypto");
const { listGroups, listTopics } = require("../utils/groupme");

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIME_TO_EXT[file.mimetype]) {
      const err = new Error("Only JPEG, PNG, or WebP images are allowed");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
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
});

// GET /api/settings (any logged-in role) — null if never configured yet.
router.get("/", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      omit: { logoBytes: true, groupmeAccessToken: true },
    });
    // Registry metadata (label/description/env-var status) travels with the
    // response instead of being duplicated in the frontend, since whether a
    // feature's requiresEnvVar is actually set is a server-side fact the
    // frontend has no way to know on its own.
    const featureRegistry = FEATURE_KEYS.map((key) => ({
      key,
      label: FEATURES[key].label,
      description: FEATURES[key].description,
      defaultEnabled: FEATURES[key].defaultEnabled,
      group: FEATURES[key].group,
      requiresEnvVar: FEATURES[key].requiresEnvVar || null,
      envVarSatisfied: FEATURES[key].requiresEnvVar
        ? Boolean(process.env[FEATURES[key].requiresEnvVar])
        : true,
    }));
    res.json({ ...shapeSettings(settings), featureRegistry });
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
      omit: { logoBytes: true, groupmeAccessToken: true },
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
    if (!matchesFileSignature(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: "File content doesn't match its declared image type" });
    }

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        logoBytes: req.file.buffer,
        logoContentType: req.file.mimetype,
        updatedById: req.user.id,
      },
      update: { logoBytes: req.file.buffer, logoContentType: req.file.mimetype, updatedById: req.user.id },
      omit: { logoBytes: true, groupmeAccessToken: true },
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
};
function shapeGroupMeSettings(settings) {
  return {
    configured: Boolean(settings?.groupmeAccessToken),
    groupId: settings?.groupmeGroupId || null,
    groupName: settings?.groupmeGroupName || null,
    prayerTopicId: settings?.groupmePrayerTopicId || null,
    prayerTopicName: settings?.groupmePrayerTopicName || null,
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
// once a group's picked; prayerTopicId/prayerTopicName once a topic is).
router.put("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const { accessToken, groupId, groupName, prayerTopicId, prayerTopicName } = groupmeSchema.parse(req.body);
    const fields = {
      groupmeGroupId: groupId,
      groupmeGroupName: groupName,
      groupmePrayerTopicId: prayerTopicId,
      groupmePrayerTopicName: prayerTopicName,
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

module.exports = router;
