const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { uploadImageToS3, deleteFromS3IfOwned } = require("../utils/s3");
const { matchesFileSignature } = require("../utils/fileSignature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

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
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings (admin only — site-wide config, same blast radius as
// user management, not per-record data like a missionary edit).
router.put("/", requireRole("admin"), async (req, res, next) => {
  try {
    const data = settingsSchema.partial().parse(req.body);
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
    });
    res.json(updated);
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

      const existing = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });

      const ext = IMAGE_MIME_TO_EXT[req.file.mimetype];
      const key = `settings/logo-${Date.now()}.${ext}`;
      const url = await uploadImageToS3(req.file.buffer, key, req.file.mimetype);

      const previousLogo = existing?.logo?.url;
      if (previousLogo) {
        deleteFromS3IfOwned(previousLogo).catch((err) => console.error("Failed to clean up old logo:", err));
      }

      const updated = await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", logo: { url }, updatedById: req.user.id },
        update: { logo: { url }, updatedById: req.user.id },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
