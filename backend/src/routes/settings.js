const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The logo's bytes live right on this row (logoBytes/logoContentType —
// see the comment on that field in schema.prisma) but every query below
// omits logoBytes and every response synthesizes this `{ url } | null`
// shape instead, same contract the frontend has always seen back when
// `logo` was a `{ url }` JSON blob pointing at S3. Presence is read off
// logoContentType (always set together with logoBytes — see POST /logo
// below) rather than logoBytes itself, so checking "is there a logo" never
// requires fetching the image data at all.
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

// Surfaces multer errors (bad file type, too large) as 400s instead of 500s.
function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

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
});

// GET /api/settings (any logged-in role) — null if never configured yet.
router.get("/", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      omit: { logoBytes: true },
    });
    res.json(shapeSettings(settings));
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
      omit: { logoBytes: true },
    });
    res.json(shapeSettings(updated));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/settings/logo (admin only)
router.post(
  "/logo",
  requireRole("admin"),
  upload.single("image"),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });
      if (!matchesFileSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File content doesn't match its declared image type" });
      }

      const updated = await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", logoBytes: req.file.buffer, logoContentType: req.file.mimetype, updatedById: req.user.id },
        update: { logoBytes: req.file.buffer, logoContentType: req.file.mimetype, updatedById: req.user.id },
        omit: { logoBytes: true },
      });

      res.json(shapeSettings(updated));
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
