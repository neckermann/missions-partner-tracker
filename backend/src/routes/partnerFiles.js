const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requirePartnerQueryScope } = require("../middleware/requireAuth");
const { canReadPartner } = require("../utils/guestAccess");
const { requireFeature } = require("../middleware/requireFeature");
const { verifyUpload } = require("../utils/fileSignature");
const { sendStoredFile } = require("../utils/fileResponse");
const { extractRequestsFromFile, isEml } = require("../utils/extraction");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { notifyNewsletterCreated } = require("../utils/dispatchRecording");
const { FILE_KINDS } = require("./fileKinds");

const router = express.Router();
router.use(requireAuth); // admin-only for now -- no public routes for this yet
router.use(requireFeature("partnerFiles"));

// Extends partnerRefSelect's own fields with `archived` -- same reasoning
// as prayerRequests.js's own prayerRequestInclude.
const fileInclude = { partner: { select: { ...partnerRefSelect.select, archived: true } } };

// .eml files don't have a reliable MIME type across browsers/OSes (often
// reported as application/octet-stream or blank), so they're recognized
// by extension instead.
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
  // Files live directly in Postgres (see the PartnerFile model comment in
  // schema.prisma) -- 10MB is the size past which the usual guidance
  // shifts from "just use the database" to "use object storage instead."
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
// A plain object (not the refined version below) so PUT /:id can
// .partial() it -- .refine() wraps a schema in a way that no longer
// exposes that (see the hand-rolled re-check on PUT below).
const metaObjectSchema = z.object(baseFields);
const metaSchema = metaObjectSchema.refine(
  (data) => data.kind !== "other" || Boolean(data.customKind?.trim()),
  {
    message: 'customKind is required when kind is "other"',
    path: ["customKind"],
  }
);

// GET /?partnerId=&kind=&entityType=&from=&to= (all partners combined, newest first)
// entityType ("missionary"|"organization") filters by the owning partner's
// own kind -- AdminPartnerFiles.jsx's "Show: Missionaries/Organizations"
// filter was client-side-only before this; from/to filter receivedDate,
// same range shape as prayerRequests.js/supportNeeds.js just added above.
router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.entityType) where.partner = { kind: String(req.query.entityType) };
    if (req.query.from || req.query.to) {
      where.receivedDate = {};
      if (req.query.from) where.receivedDate.gte = new Date(String(req.query.from));
      if (req.query.to) where.receivedDate.lte = new Date(String(req.query.to));
    }

    const records = await prisma.partnerFile.findMany({
      where,
      include: fileInclude,
      // No omit needed -- file content lives in its own table (bytesRow)
      // now, never selected here, only via GET /:id/download.
      // createdAt as a tiebreaker -- see the same comment in prayerRequests.js.
      orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST / (upload -- editor or admin)
router.post("/", requireRole("admin", "editor"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    // #327 Finding 8: this used to store req.file.mimetype as-is whenever
    // the filename ended in .eml, skipping the signature check entirely
    // for that case -- a file named x.eml declared as application/pdf
    // was stored unverified and later served inline as PDF
    // (VERIFIED_INLINE_TYPES, utils/fileResponse.js). verifyUpload always
    // forces message/rfc822 for a real .eml, never the client's own
    // declared type; everything else still gets signature-checked.
    const verified = verifyUpload(req.file);
    if (!verified.ok) {
      return res.status(400).json({ error: "File content doesn't match its declared type" });
    }

    const meta = metaSchema.parse(req.body);

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
      // Best-effort: notifyNewsletterCreated never throws -- see the same
      // comment in routes/prayerRequests.js.
      await notifyNewsletterCreated(created);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /:id/download -- streams the file straight from the database (still
// requireAuth'd, per router.use above; no separate signed URL to generate
// since there's no external store to sign a URL for).
//
// Unlike GET / above, this single-record route has no requirePartnerQueryScope
// of its own -- every other role is fine with that (any login already sees
// every partner's files via the unscoped list route), but a guest must
// not be able to download an arbitrary file id belonging to some other
// partner just because they know (or guessed) it. Checked here explicitly,
// same pattern as partners.js's own GET /:id.
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

// PUT /:id (update metadata -- editor or admin). Everything but the file
// itself is editable, including `kind` (reclassifying is just an ordinary
// edit -- there's no separate "reclassify" action) and moving it to a
// different partner. The file's bytes/fileName/contentType/fileSize are
// immutable (upload a new file and delete this one if the file's wrong).
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = metaObjectSchema.partial().parse(req.body);

    const existing = await prisma.partnerFile.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" }); // no bytesRow needed -- metadata only

    // The one metaSchema refinement that still needs re-checking on a
    // partial update: either field can arrive alone, so "other" requires
    // a customKind is evaluated against what the record will actually
    // look like after the merge, not just the raw body.
    const kind = data.kind !== undefined ? data.kind : existing.kind;
    const customKind = data.customKind !== undefined ? data.customKind : existing.customKind;
    if (kind === "other" && !customKind?.trim()) {
      return res.status(400).json({ error: 'customKind is required when kind is "other"' });
    }
    // Clear a stale customKind left over from a prior "other" once kind
    // moves away from it, rather than leaving an orphaned label around.
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

// POST /:id/extract -- scans the file with Claude for prayer requests and
// one-time needs (editor or admin, same as upload). Gated on the
// "aiExtraction" feature specifically (not this router's own feature gate
// above) since a church can have Newsletters & Docs on but AI scanning
// off. Nothing is persisted here -- the caller reviews and explicitly
// adds each suggestion via the existing POST /api/prayer-requests /
// /api/support-needs. Not restricted by kind -- governed by whether the
// stored file's actual content type is one Claude can read (PDF/JPEG/PNG;
// extractRequestsFromFile 400s clearly for anything else, e.g. a raw .eml
// or Word/Excel file), a more accurate constraint than guessing from kind.
router.post(
  "/:id/extract",
  requireRole("admin", "editor"),
  requireFeature("aiExtraction"),
  async (req, res, next) => {
    try {
      // The file's bytes live in the split-off PartnerFileBytes table (see
      // that model's own comment), not on PartnerFile itself -- same
      // include GET /:id/download above already uses. Without it,
      // record.bytes is always undefined and buildFileBlock's
      // Buffer.from(undefined) throws on every single scan attempt.
      const record = await prisma.partnerFile.findUnique({
        where: { id: req.params.id },
        include: { bytesRow: { select: { bytes: true } } },
      });
      if (!record?.bytesRow) return res.status(404).json({ error: "Not found" });

      // #323: warn (non-blocking -- the admin can still add more
      // suggestions) when this file already produced saved records on an
      // earlier scan. Independent of the extraction call itself (a
      // read-only count against PrayerRequest/SupportNeed.sourceFileId,
      // both of which already point back at this file -- see their own
      // comments in schema.prisma), so it runs alongside it rather than
      // after, with no added latency over the extraction call alone.
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
