const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { buildBlurb } = require("../utils/notificationBlurbs");
const { needsReview } = require("../utils/notificationEligibility");
const { countUrgentRecipients } = require("../utils/notificationOrchestrator");

// The review queue for recorded events -- a row is written by
// notificationRecording.js the instant something happens, and leaves
// this queue once every applicable channel's own pass has handled it
// (GroupMe's own daily schedule, or one of the three email cadence
// tiers) -- see notificationOrchestrator.js's clearNotifiableEvents().
// There's no manual "send now" action anymore: the old one force-sent
// the now-retired church-wide email digest alongside GroupMe, and that
// mechanism has no equivalent once every recipient has their own
// cadence -- see the plan this was built from for why it was removed
// outright rather than redesigned.
const router = express.Router();
router.use(requireAuth);

// GET /api/notifications/pending -- any logged-in role, same "viewing is
// harmless" reasoning as GET /api/partner-files/GET /api/inbound-email.
// Reuses buildBlurb so the admin sees the exact same summary text that
// would actually go out, not a second, hand-maintained description of
// it. Deliberately unfiltered -- every row shows here regardless of
// which channel(s) it's actually relevant to (e.g. a prayer request
// muted on GroupMe but still relevant to the public digest still shows),
// since this page was never scoped to any one channel's relevance in
// the first place.
router.get("/pending", async (req, res, next) => {
  try {
    const rows = await prisma.notifiableEvent.findMany({ orderBy: { createdAt: "asc" } });
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));
    // Not role-gated: GET /api/prayer-requests and GET /api/support-needs
    // already return a restricted partner's real request/need text to
    // every logged-in role with no masking at all (this app's "auth is
    // the boundary" rule -- see ADMIN_GUIDE.md § Who can see what), so
    // hiding it specifically in this list behind a role check wouldn't
    // protect anything a viewer couldn't already read on those pages --
    // it would just make this one list inconsistent with the rest of the
    // app for no real reason. Showing it here too means an admin/editor
    // reviewing a held row can read it and hit Approve without opening
    // Edit first.
    const items = rows
      .map((row) => {
        const blurb = buildBlurb(row, partnerById.get(row.partnerId));
        if (!blurb) return null;
        const held = needsReview(row, partnerById.get(row.partnerId));
        const bodyText = held
          ? (buildBlurb(row, { ...partnerById.get(row.partnerId), isRestricted: false })?.bodyText ??
            blurb.bodyText)
          : blurb.bodyText;
        return {
          ...blurb,
          bodyText,
          // Surfaced separately from the masking itself (the blurb's own
          // fields are already masked above) so the admin reviewing the
          // queue can see at a glance which rows are from a restricted
          // partner, without this route handing back anything it
          // wouldn't otherwise.
          isRestricted: !!partnerById.get(row.partnerId)?.isRestricted,
          // Whether this row is currently held out of every channel --
          // restricted real-content row, never yet edited/confirmed. An
          // urgent send is held exactly the same way; there's no
          // separate flag for that, urgent just means "don't wait for a
          // schedule," never "skip review."
          needsReview: held,
          reviewedAt: row.reviewedAt,
          groupmeSentAt: row.groupmeSentAt,
          biweeklyDigestSentAt: row.biweeklyDigestSentAt,
          monthlyDigestSentAt: row.monthlyDigestSentAt,
          quarterlyDigestSentAt: row.quarterlyDigestSentAt,
          createdAt: row.createdAt,
        };
      })
      .filter(Boolean);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/pending/:id -- admin or editor, not the bare
// requireAuth every role gets for the masked list above: this exposes
// the REAL unmasked text, a restricted partner's included, so it's
// gated the same as everything else that mutates/reveals more than the
// list view (#187). Reuses buildBlurb against a synthetic
// isRestricted:false view of the partner, instead of duplicating each
// type's own text-composition logic (note concatenation, amount
// wording, etc.) here -- never returns the partner's real name/photo,
// since masking those stays out of scope for this feature and the admin
// already knows who this row is for from the page's own grouping.
router.get("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const row = await prisma.notifiableEvent.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Not found" });
    const partner = await prisma.partner.findUnique({
      where: { id: row.partnerId },
      select: { displayName: true, isRestricted: true },
    });
    const unmasked = buildBlurb(row, partner ? { ...partner, isRestricted: false } : null);
    res.json({ rawText: row.reviewedAt ? row.reviewedText : (unmasked?.bodyText ?? null) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/pending/:id -- admin or editor, same gate as
// every other queue-mutating route. Available on any row regardless of
// type or restriction -- an admin might want to tidy up the wording on
// anything before it sends, not just a restricted partner's held row
// (#187). For a restricted real-content row specifically, saving here is
// also what satisfies notificationEligibility.js's needsReview() gate;
// for every other row it's purely a content edit with no send-
// eligibility consequence. Re-callable: saving again overwrites the
// previous edit.
router.put("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    const row = await prisma.notifiableEvent.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.notifiableEvent.update({
      where: { id: row.id },
      data: { reviewedAt: new Date(), reviewedById: req.user.id, reviewedText: text },
    });
    const partner = await prisma.partner.findUnique({
      where: { id: updated.partnerId },
      select: { displayName: true, isRestricted: true },
    });
    const blurb = buildBlurb(updated, partner);
    res.json({
      ...blurb,
      isRestricted: !!partner?.isRestricted,
      needsReview: false,
      reviewedAt: updated.reviewedAt,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/pending/:id -- admin or editor, same gate as
// editing. Discards one recorded event without ever sending it on any
// channel -- e.g. a restricted partner's update that shouldn't go out
// at all this round. Irreversible (no undo queue), same as deleting any
// other record in this app.
router.delete("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const deleted = await prisma.notifiableEvent.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/urgent-recipient-count?partnerId= -- admin or
// editor (same role gate as marking something urgent at all), used to
// populate the confirm dialog's real numbers before an urgent send
// actually fires. Cadence-blind and approximate on purpose -- see
// countUrgentRecipients' own comment.
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
