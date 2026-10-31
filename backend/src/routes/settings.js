const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");
const { FEATURES, FEATURE_KEYS } = require("../utils/features");
const { encryptField } = require("../utils/crypto");

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
      omit: { logoBytes: true, groupmeBotId: true },
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
      omit: { logoBytes: true, groupmeBotId: true },
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
      omit: { logoBytes: true, groupmeBotId: true },
    });

    res.json(shapeSettings(updated));
  } catch (err) {
    next(err);
  }
});

const groupmeSchema = z.object({
  // Omitted/blank leaves the stored bot_id untouched -- the same
  // write-only-field UX as a password-change form, since there is no
  // "current value" to show back and nothing to merge it against. The
  // admin creates the group and the bot themselves directly in GroupMe
  // (dev.groupme.com/bots) -- this is just where the resulting bot_id
  // gets pasted in, never a value this app generates.
  botId: z.string().trim().min(1).optional(),
  groupName: z.string().trim().optional().nullable(),
});

// GET /api/settings/groupme (admin only -- not folded into GET /, which
// any logged-in role can read; this entire feature stays behind the
// admin gate, not just its writes).
router.get("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeBotId: true, groupmeGroupName: true },
    });
    res.json({
      configured: Boolean(settings?.groupmeBotId),
      groupName: settings?.groupmeGroupName || null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/groupme (admin only)
router.put("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const { botId, groupName } = groupmeSchema.parse(req.body);
    const data = { groupmeGroupName: groupName };
    if (botId) data.groupmeBotId = encryptField(botId);

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: { groupmeBotId: true, groupmeGroupName: true },
    });
    res.json({
      configured: Boolean(updated.groupmeBotId),
      groupName: updated.groupmeGroupName || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
