const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { matchesFileSignature } = require("../utils/fileSignature");

const router = express.Router();
router.use(requireAuth); // admin-only for now — no public routes for this yet

// Keys are what's stored on Document.category and sent/received over the
// API; labels are for display only (frontend has its own copy of these —
// see frontend/src/pages/AdminDocuments.jsx). "other" is the one category
// that pairs with a free-typed `customCategory` instead of a fixed label.
const CATEGORIES = ["survey_response", "signed_policy", "email", "office_document", "other"];

const MIME_TO_EXT = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

// .eml files don't have a reliable MIME type across browsers/OSes (often
// reported as application/octet-stream or blank), so they're recognized by
// extension instead — same approach as routes/newsletters.js.
function resolveExt(file) {
  if (MIME_TO_EXT[file.mimetype]) return MIME_TO_EXT[file.mimetype];
  if (/\.eml$/i.test(file.originalname)) return "eml";
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  // 10MB, not the 20MB this used to allow -- see the same comment in
  // routes/newsletters.js.
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!resolveExt(file)) {
      const err = new Error("Only PDF, Word, Excel, .eml, JPEG, or PNG files are allowed");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

const documentInclude = {
  missionary: { select: { id: true, displayName: true } },
  organization: { select: { id: true, name: true } },
};

const metaSchema = z
  .object({
    missionaryId: z.string().optional().nullable(),
    organizationId: z.string().optional().nullable(),
    category: z.enum(CATEGORIES),
    customCategory: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    receivedDate: z.coerce.date(),
    notes: z.string().optional().nullable(),
  })
  .refine((data) => Boolean(data.missionaryId) !== Boolean(data.organizationId), {
    message: "Exactly one of missionaryId or organizationId is required",
    path: ["missionaryId"],
  })
  .refine((data) => data.category !== "other" || Boolean(data.customCategory?.trim()), {
    message: "customCategory is required when category is \"other\"",
    path: ["customCategory"],
  });

// GET /api/documents (all entities combined, newest first) — optional
// ?category=, ?missionaryId=, ?organizationId= query filters for the
// consolidated admin list page; the frontend also does its own client-side
// filtering on top of this for instant response without a round-trip.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.missionaryId) where.missionaryId = String(req.query.missionaryId);
    if (req.query.organizationId) where.organizationId = String(req.query.organizationId);

    const records = await prisma.document.findMany({
      where,
      include: documentInclude,
      omit: { bytes: true }, // file content only ever comes back via GET /:id/download
      orderBy: { receivedDate: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents (upload — editor or admin)
router.post(
  "/",
  requireRole("admin", "editor"),
  upload.single("file"),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });

      // .eml has no reliable magic bytes across mail clients (see
      // resolveExt above), so it's exempt -- everything else this route
      // accepts does have one and gets verified.
      if (!/\.eml$/i.test(req.file.originalname) && !matchesFileSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File content doesn't match its declared type" });
      }

      const meta = metaSchema.parse(req.body);

      const created = await prisma.document.create({
        data: {
          ...meta,
          bytes: req.file.buffer,
          fileName: req.file.originalname,
          contentType: req.file.mimetype || "application/octet-stream",
          fileSize: req.file.size,
          createdById: req.user.id,
        },
        include: documentInclude,
        omit: { bytes: true },
      });

      res.status(201).json(created);
    } catch (err) {
      if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
      next(err);
    }
  }
);

// GET /api/documents/:id/download — streams the file straight from the
// database (still requireAuth'd, per router.use above; no separate signed
// URL to generate since there's no external store to sign a URL for).
router.get("/:id/download", async (req, res, next) => {
  try {
    const record = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Not found" });

    res.set("Content-Type", record.contentType || "application/octet-stream");
    res.set("Content-Disposition", `inline; filename="${record.fileName.replace(/"/g, "")}"`);
    res.send(record.bytes);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const record = await prisma.document.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!record) return res.status(404).json({ error: "Not found" });

    await prisma.document.delete({ where: { id: req.params.id } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
