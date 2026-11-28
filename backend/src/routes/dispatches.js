const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { buildBlurb } = require("../utils/dispatchBlurbs");
const { needsReview } = require("../utils/dispatchEligibility");
const { countUrgentRecipients, sendUrgentDispatch } = require("../utils/dispatchOrchestrator");

// The review queue for recorded events: a row is written by dispatchRecording.js
// when something happens and leaves once every applicable channel has handled
// it (see dispatchOrchestrator.js's clearDispatchRecords()). There is no manual
// "send now".
const router = express.Router();
router.use(requireAuth);

// GET /api/dispatches/pending -- the exact text about to go out, churchwide.
// There is no trip-scoped version of it, so Trip Leader guests are excluded
// entirely (requireRole below) rather than scoped. Reuses buildBlurb so the
// admin sees what would actually go out. Deliberately unfiltered by channel.
router.get("/pending", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const [rows, settings] = await Promise.all([
      prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { restrictedPartnerInitialsEnabled: true },
      }),
    ]);
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, fieldDisplayName: true, isRestricted: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));
    // Not gated further by role: prayer-requests and support-needs already
    // return a restricted partner's real text to every full role (ADMIN_GUIDE.md
    // § Who can see what), so gating here would only be inconsistent.
    const items = rows
      .map((row) => {
        const blurb = buildBlurb(row, partnerById.get(row.partnerId), settings);
        if (!blurb) return null;
        const held = needsReview(row, partnerById.get(row.partnerId));
        const bodyText = held
          ? (buildBlurb(row, { ...partnerById.get(row.partnerId), isRestricted: false }, settings)
              ?.bodyText ?? blurb.bodyText)
          : blurb.bodyText;
        return {
          ...blurb,
          bodyText,
          isRestricted: !!partnerById.get(row.partnerId)?.isRestricted,
          // Held out of every channel until edited/confirmed. Urgent is held
          // too: it means "don't wait for a schedule," never "skip review."
          needsReview: held,
          // Held for review although the partner isn't restricted: a care team
          // member entered it.
          reviewRequired: !!row.reviewRequired,
          dispatchReviewedAt: row.dispatchReviewedAt,
          groupmeDispatchedAt: row.groupmeDispatchedAt,
          whatsappDispatchedAt: row.whatsappDispatchedAt,
          biweeklyEmailDispatchSentAt: row.biweeklyEmailDispatchSentAt,
          monthlyEmailDispatchSentAt: row.monthlyEmailDispatchSentAt,
          quarterlyEmailDispatchSentAt: row.quarterlyEmailDispatchSentAt,
          createdAt: row.createdAt,
        };
      })
      .filter(Boolean);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatches/pending/:id -- admin or editor, not the bare requireAuth:
// this returns the REAL unmasked text, a restricted partner's included, so it
// is gated like everything else that reveals more than the list view. Reuses
// buildBlurb with isRestricted forced false; never returns the real name/photo.
router.get("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const row = await prisma.dispatchRecord.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Not found" });
    const partner = await prisma.partner.findUnique({
      where: { id: row.partnerId },
      select: { displayName: true, isRestricted: true },
    });
    const unmasked = buildBlurb(row, partner ? { ...partner, isRestricted: false } : null);
    res.json({ rawText: row.dispatchReviewedAt ? row.dispatchReviewedText : (unmasked?.bodyText ?? null) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/dispatches/pending/:id -- admin or editor. Allowed on any row; for a
// held row, saving also satisfies needsReview(). Re-callable.
router.put("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    const row = await prisma.dispatchRecord.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Not found" });

    const firstApproval = !row.dispatchReviewedAt;
    const updated = await prisma.dispatchRecord.update({
      where: { id: row.id },
      data: {
        dispatchReviewedAt: new Date(),
        dispatchReviewedById: req.user.id,
        dispatchReviewedText: text,
      },
    });
    // An urgent update that was held for review could not go out when it was made. Approving it is what
    // lets it go, so it goes now (every channel still applies its own rules) rather than at the next
    // scheduled send. Only the first approval does this; editing the wording afterwards never re-sends.
    let urgentSent = null;
    if (firstApproval && updated.payload?.urgent === true) {
      try {
        urgentSent = await sendUrgentDispatch(updated, { id: updated.partnerId });
      } catch (err) {
        console.error("Urgent send after approval failed:", err.message);
      }
    }
    const [partner, settings] = await Promise.all([
      prisma.partner.findUnique({
        where: { id: updated.partnerId },
        select: { displayName: true, fieldDisplayName: true, isRestricted: true },
      }),
      prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { restrictedPartnerInitialsEnabled: true },
      }),
    ]);
    const blurb = buildBlurb(updated, partner, settings);
    res.json({
      ...blurb,
      isRestricted: !!partner?.isRestricted,
      reviewRequired: !!updated.reviewRequired,
      needsReview: false,
      dispatchReviewedAt: updated.dispatchReviewedAt,
      urgentSent,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/dispatches/pending/:id -- admin or editor. Discards one recorded
// event without sending it on any channel. Irreversible.
router.delete("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const deleted = await prisma.dispatchRecord.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatches/urgent-recipient-count?partnerId= -- admin or editor, for
// the urgent-send confirm dialog. Cadence-blind and approximate on purpose (see
// countUrgentRecipients).
router.get("/urgent-recipient-count", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const partnerId = String(req.query.partnerId || "");
    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    res.json(await countUrgentRecipients(partnerId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
