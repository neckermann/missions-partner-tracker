const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { buildBlurb } = require("../utils/notificationBlurbs");
const { needsReview } = require("../utils/notificationEligibility");
const { countUrgentRecipients } = require("../utils/notificationOrchestrator");

// The review queue for recorded events -- a row is written by
// notificationRecording.js the instant something happens, and leaves
// this queue once every applicable channel's pass has handled it
// (GroupMe's daily schedule, or one of the three email cadence tiers)
// -- see notificationOrchestrator.js's clearNotifiableEvents(). No
// manual "send now" action anymore: the old one force-sent the
// now-retired church-wide digest, which has no equivalent once every
// recipient has their own cadence.
const router = express.Router();
router.use(requireAuth);

// GET /api/notifications/pending -- any logged-in role, same "viewing is
// harmless" reasoning as GET /api/partner-files/GET /api/inbound-email.
// Reuses buildBlurb so the admin sees the exact same text that would
// actually go out. Deliberately unfiltered -- every row shows here
// regardless of which channel(s) it's relevant to (e.g. a prayer
// request muted on GroupMe but still relevant to the public digest
// still shows), since this page was never scoped to one channel.
router.get("/pending", async (req, res, next) => {
  try {
    const rows = await prisma.notifiableEvent.findMany({ orderBy: { createdAt: "asc" } });
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));
    // Not role-gated: GET /api/prayer-requests and GET /api/support-needs
    // already return a restricted partner's real text to every logged-in
    // role unmasked (this app's "auth is the boundary" rule -- see
    // ADMIN_GUIDE.md § Who can see what), so gating it here too would
    // just make this list inconsistent for no real protection.
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
          // So the admin can see at a glance which rows are restricted,
          // without this route handing back anything new.
          isRestricted: !!partnerById.get(row.partnerId)?.isRestricted,
          // Held out of every channel -- restricted, never yet
          // edited/confirmed. Urgent is held the same way: it means
          // "don't wait for a schedule," never "skip review."
          needsReview: held,
          reviewedAt: row.reviewedAt,
          groupmeSentAt: row.groupmeSentAt,
          whatsappSentAt: row.whatsappSentAt,
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
// requireAuth above: this returns the REAL unmasked text, a restricted
// partner's included, so it's gated like everything else that reveals
// more than the list view (#187). Reuses buildBlurb against a synthetic
// isRestricted:false partner rather than duplicating each type's own
// text composition here -- never returns the real name/photo, which
// stays out of scope since the admin already knows who this row is for.
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

// PUT /api/notifications/pending/:id -- admin or editor. Available on
// any row, not just a restricted partner's held one (#187) -- an admin
// might want to tidy up wording generally. For a restricted row
// specifically, saving here also satisfies needsReview(); for every
// other row it's purely a content edit. Re-callable.
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
