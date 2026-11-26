const express = require("express");
const { withSendingChurch } = require("../utils/sendingChurch");

const { z } = require("zod");
const prisma = require("../prismaClient");
const {
  requireAuth,
  requireRole,
  allowGuestPartnerList,
  requirePartnerWriter,
} = require("../middleware/requireAuth");
const { canReadPartner, readablePartnerIds, isOnCareTeamFor } = require("../utils/guestAccess");
const { requireFeature } = require("../middleware/requireFeature");
const { verifyUpload } = require("../utils/fileSignature");
const { sendStoredFile } = require("../utils/fileResponse");
const { extractRequestsFromFile, isEml } = require("../utils/extraction");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { notifyNewsletterCreated } = require("../utils/dispatchRecording");
const { FILE_KINDS } = require("./fileKinds");

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("partnerFiles"));

const fileInclude = { partner: { select: { ...partnerRefSelect.select, archived: true } } };

// .eml has no reliable browser MIME type (often octet-stream or blank), so it is
// recognized by extension.
const MIME_TO_EXT = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const resolveExt = makeExtResolver(MIME_TO_EXT, { test: isEml, ext: "eml" });

const upload = uploadFilteredBy(resolveExt, {
  // Files live in Postgres; 10MB is where object storage becomes the better choice.
  maxFileSize: 10 * 1024 * 1024,
  message: "Only PDF, Word, Excel, .eml, JPEG, or PNG files are allowed",
});

const baseFields = {
  partnerId: z.string(),
  title: z.string().optional().nullable(),
  receivedDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
  kind: z.enum(FILE_KINDS),
  customKind: z.string().optional().nullable(),
};
// Plain object so PUT /:id can .partial() it; .refine() would hide that (PUT re-checks by hand).
const metaObjectSchema = z.object(baseFields);
const metaSchema = metaObjectSchema.refine(
  (data) => data.kind !== "other" || Boolean(data.customKind?.trim()),
  {
    message: 'customKind is required when kind is "other"',
    path: ["customKind"],
  }
);

// GET /?partnerId=&kind=&entityType=&from=&to= -- all partners, newest first.
// entityType filters by the owning partner's kind; from/to filter receivedDate.
router.get("/", allowGuestPartnerList, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    // A guest without a named partner sees only the partners they reach (#289): the server is the boundary.
    const reachable = readablePartnerIds(req.user);
    if (reachable && !req.query.partnerId) where.partnerId = { in: reachable };
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.entityType) where.partner = { kind: String(req.query.entityType) };
    withSendingChurch(where, req.query.sendingChurch);
    if (req.query.from || req.query.to) {
      where.receivedDate = {};
      if (req.query.from) where.receivedDate.gte = new Date(String(req.query.from));
      if (req.query.to) where.receivedDate.lte = new Date(String(req.query.to));
    }

    const records = await prisma.partnerFile.findMany({
      where,
      include: fileInclude,
      orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST / (upload -- editor or admin)
// Admin/editor, or a care team member for their own partner (#289). Editing, deleting and AI
// scanning stay staff-only; a care team member's newsletter dispatch is held for staff review.
router.post(
  "/",
  requireRole("admin", "editor", "viewer", "guest"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const staff = req.user.role === "admin" || req.user.role === "editor";

      // verifyUpload forces message/rfc822 for a real .eml, never the client's declared type, so a
      // mislabelled .eml cannot skip the signature check and be served inline (VERIFIED_INLINE_TYPES).
      const verified = verifyUpload(req.file);
      if (!verified.ok) {
        return res.status(400).json({ error: "File content doesn't match its declared type" });
      }

      const meta = metaSchema.parse(req.body);
      if (!staff && !(await isOnCareTeamFor(req.user, meta.partnerId))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const created = await prisma.partnerFile.create({
        data: {
          ...meta,
          fileName: req.file.originalname,
          contentType: verified.contentType,
          fileSize: req.file.size,
          bytesRow: { create: { bytes: req.file.buffer } },
        },
        include: fileInclude,
      });

      if (created.kind === "newsletter") {
        // Best-effort: notifyNewsletterCreated never throws.
        await notifyNewsletterCreated(created, { requireReview: !staff });
      }

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

// Streams from the database. Unlike GET /, there is no requirePartnerQueryScope here: a guest
// must not download another partner's file by id, so it is checked explicitly (as in partners.js GET /:id).
router.get("/:id/download", async (req, res, next) => {
  try {
    const record = await prisma.partnerFile.findUnique({
      where: { id: req.params.id },
      include: { bytesRow: { select: { bytes: true } } },
    });
    if (!record?.bytesRow) return res.status(404).json({ error: "Not found" });

    if (!canReadPartner(req.user, record.partnerId)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    sendStoredFile(res, { ...record, bytes: record.bytesRow.bytes });
  } catch (err) {
    next(err);
  }
});

// PUT /:id (update metadata -- editor or admin). Everything but the file itself is editable,
// including `kind` and the owning partner; bytes/fileName/contentType/fileSize are immutable.
router.put("/:id", requirePartnerWriter({ model: "partnerFile" }), async (req, res, next) => {
  try {
    const data = metaObjectSchema.partial().parse(req.body);

    const existing = await prisma.partnerFile.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    // "other" requires a customKind: checked against the merged record, since either field can arrive alone.
    const kind = data.kind !== undefined ? data.kind : existing.kind;
    const customKind = data.customKind !== undefined ? data.customKind : existing.customKind;
    if (kind === "other" && !customKind?.trim()) {
      return res.status(400).json({ error: 'customKind is required when kind is "other"' });
    }
    // Clear a stale customKind once kind moves away from "other".
    if (kind !== "other" && data.customKind === undefined) data.customKind = null;

    const updated = await prisma.partnerFile.update({
      where: { id: req.params.id },
      data,
      include: fileInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /:id/extract -- scans the file with Claude for prayer requests and needs (editor or admin).
// Gated on "aiExtraction" separately from this router's feature gate. Nothing is persisted: the
// caller adds each suggestion via the normal create routes. extractRequestsFromFile 400s for
// content types Claude cannot read (anything but PDF/JPEG/PNG).
//
// Staff only: a care team guest can write to their partner's files but must not be able to send a letter to
// an outside service. And a restricted partner's letter is only sent after the caller confirms they know
// it leaves the app (confirmRestricted: true); without it the answer is 409 before anything is sent.
router.post(
  "/:id/extract",
  requireRole("admin", "editor"),
  requirePartnerWriter({ model: "partnerFile" }),
  requireFeature("aiExtraction"),
  async (req, res, next) => {
    try {
      // Bytes live in PartnerFileBytes; without this include record.bytes is undefined and
      // buildFileBlock throws.
      const record = await prisma.partnerFile.findUnique({
        where: { id: req.params.id },
        include: { bytesRow: { select: { bytes: true } }, partner: { select: { isRestricted: true } } },
      });
      if (!record?.bytesRow) return res.status(404).json({ error: "Not found" });
      if (record.partner?.isRestricted && req.body?.confirmRestricted !== true) {
        return res.status(409).json({
          needsConfirmation: true,
          error:
            "This partner is restricted. Scanning sends the whole letter to an outside AI service (Anthropic), outside this app. Confirm to continue.",
        });
      }

      // Non-blocking warning when this file already produced saved records on an earlier scan;
      // runs alongside the extraction.
      const [suggestions, priorPrayerRequestCount, priorSupportNeedCount] = await Promise.all([
        extractRequestsFromFile({ ...record, bytes: record.bytesRow.bytes }),
        prisma.prayerRequest.count({ where: { sourceFileId: req.params.id } }),
        prisma.supportNeed.count({ where: { sourceFileId: req.params.id } }),
      ]);
      res.json({ ...suggestions, alreadyScannedCount: priorPrayerRequestCount + priorSupportNeedCount });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /:id (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const record = await prisma.partnerFile.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!record) return res.status(404).json({ error: "Not found" });

    await prisma.partnerFile.delete({ where: { id: req.params.id } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
