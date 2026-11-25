const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { recordAuditSafe } = require("../utils/auditLog");
const { PHOTO, loadContext, applyField } = require("../utils/surveyFields");
const { describeSupportValue, FIELD: SUPPORT_FIELD } = require("../utils/surveySupport");

// #419: the changes survey answers suggest to a partner's record. A person approves (optionally
// editing the value first) or rejects each one; approving writes through the same columns the
// partner page edits, as the approver, so "last edited by" and the audit log credit them. Nothing
// is applied automatically. Gated by `surveys` + `careTeam`; admins and editors only.
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("surveys"));
router.use(requireFeature("careTeam"));
router.use(requireRole("admin", "editor"));

const nameOf = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;

const shape = (p) => ({
  id: p.id,
  status: p.status,
  partnerId: p.partnerId,
  partnerName: p.partner.displayName,
  surveyTitle: p.survey.title,
  field: p.field,
  fieldLabel: p.fieldLabel,
  currentValue: p.currentValue,
  proposedValue: p.proposedValue,
  appliedValue: p.appliedValue,
  photoUploadId: p.uploadId,
  createdAt: p.createdAt,
  decidedAt: p.decidedAt,
  decidedByName: p.decidedByName,
});

const include = { partner: { select: { displayName: true } }, survey: { select: { title: true } } };

// GET /api/survey-updates?status=pending|decided
router.get("/", async (req, res, next) => {
  try {
    const decided = req.query.status === "decided";
    const rows = await prisma.surveyProposal.findMany({
      where: decided ? { status: { not: "pending" } } : { status: "pending" },
      orderBy: decided ? { decidedAt: "desc" } : { createdAt: "asc" },
      take: decided ? 200 : 500,
      include,
    });
    const updates = rows.map(shape);
    // A support-preferences change is stored as JSON; show it as one readable line per option.
    for (const u of updates) {
      if (u.field !== SUPPORT_FIELD) continue;
      u.currentDisplay = await describeSupportValue(prisma, u.currentValue);
      u.proposedDisplay = await describeSupportValue(prisma, u.proposedValue);
    }
    res.json({ updates });
  } catch (err) {
    next(err);
  }
});

// GET /api/survey-updates/photo/:uploadId -- the photo awaiting a decision, for the review page.
router.get("/photo/:uploadId", async (req, res, next) => {
  try {
    const upload = await prisma.surveyUpload.findUnique({ where: { id: req.params.uploadId } });
    if (!upload) return res.status(404).end();
    res.set("Content-Type", upload.contentType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.set("Cache-Control", "private, no-store");
    res.send(upload.bytes);
  } catch (err) {
    next(err);
  }
});

async function loadPending(id) {
  const proposal = await prisma.surveyProposal.findUnique({ where: { id }, include });
  if (!proposal) return { status: 404, error: "Not found" };
  if (proposal.status !== "pending") return { status: 409, error: "That change was already decided" };
  return { proposal };
}

const audit = (req, action, proposal, details) =>
  recordAuditSafe(null, {
    action,
    actor: req.user,
    entity: { type: "partner", id: proposal.partnerId, label: proposal.partner.displayName },
    req,
    details: { field: proposal.fieldLabel, survey: proposal.survey.title, ...details },
  });

// POST /api/survey-updates/:id/approve  { value? } -- apply it (the edited `value` if given).
router.post("/:id/approve", async (req, res, next) => {
  try {
    const { value } = z.object({ value: z.string().max(2000).optional() }).parse(req.body || {});
    const found = await loadPending(req.params.id);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { proposal } = found;
    const ctx = await loadContext(prisma, proposal.partnerId);
    if (!ctx) return res.status(404).json({ error: "That partner no longer exists" });
    const decided = {
      status: "approved",
      decidedAt: new Date(),
      decidedById: req.user.id,
      decidedByName: nameOf(req.user),
    };

    if (proposal.field === PHOTO) {
      const upload = proposal.uploadId
        ? await prisma.surveyUpload.findUnique({ where: { id: proposal.uploadId } })
        : null;
      if (!upload) return res.status(409).json({ error: "The photo is no longer available" });
      await prisma.$transaction(async (tx) => {
        await tx.photo.create({
          data: {
            partnerId: proposal.partnerId,
            receivedDate: new Date(),
            contentType: upload.contentType,
            fileSize: upload.fileSize,
            bytesRow: { create: { bytes: upload.bytes } },
          },
        });
        await tx.surveyProposal.update({
          where: { id: proposal.id },
          data: { ...decided, appliedValue: "Photo added" },
        });
        await tx.surveyUpload.delete({ where: { id: upload.id } });
      });
      await audit(req, "survey.update_approved", proposal, { applied: "new photo" });
      return res.json({ approved: true });
    }

    const toApply = (value ?? proposal.proposedValue ?? "").trim();
    let failure = null;
    await prisma.$transaction(async (tx) => {
      const result = await applyField(tx, ctx, proposal.field, toApply);
      if (result.error) {
        failure = result.error;
        return;
      }
      await tx.surveyProposal.update({
        where: { id: proposal.id },
        data: { ...decided, appliedValue: result.applied },
      });
    });
    if (failure) return res.status(400).json({ error: failure });
    await audit(req, "survey.update_approved", proposal, { from: proposal.currentValue, to: toApply });
    res.json({ approved: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/survey-updates/:id/reject -- leave the record as it is (a rejected photo is deleted).
router.post("/:id/reject", async (req, res, next) => {
  try {
    const found = await loadPending(req.params.id);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { proposal } = found;
    await prisma.$transaction(async (tx) => {
      await tx.surveyProposal.update({
        where: { id: proposal.id },
        data: {
          status: "rejected",
          decidedAt: new Date(),
          decidedById: req.user.id,
          decidedByName: nameOf(req.user),
        },
      });
      if (proposal.uploadId) await tx.surveyUpload.deleteMany({ where: { id: proposal.uploadId } });
    });
    await audit(req, "survey.update_rejected", proposal, {});
    res.json({ rejected: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
