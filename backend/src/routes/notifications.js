const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { buildBlurb, REVIEW_GATED_TYPES } = require("../utils/notificationBlurbs");
const { flushPendingNotifications } = require("../utils/notificationFlush");

// The batched-notification review queue (see #129) -- what used to post
// live to GroupMe the instant an event happened now collects in
// PendingNotification rows (written by utils/notifications.js) until an
// admin/editor flushes them here, manually or via
// utils/digestScheduler.js's own call into the same flush logic in
// utils/notificationFlush.js.
const router = express.Router();
router.use(requireAuth);

// GET /api/notifications/pending -- any logged-in role, same "viewing is
// harmless" reasoning as GET /api/partner-files/GET /api/inbound-email.
// Reuses buildBlurb so the admin sees the exact same summary text that
// would actually go out, not a second, hand-maintained description of
// it.
router.get("/pending", async (req, res, next) => {
  try {
    const rows = await prisma.pendingNotification.findMany({ orderBy: { createdAt: "asc" } });
    // Same masking-needs-the-live-flag reasoning as notificationFlush.js
    // -- this preview should show admins exactly what would actually go
    // out, restricted-partner masking included.
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));
    const items = rows
      .map((row) => {
        const blurb = buildBlurb(row, partnerById.get(row.partnerId));
        if (!blurb) return null;
        return {
          ...blurb,
          // Surfaced separately from the masking itself (the blurb's own
          // fields are already masked above) so the admin reviewing the
          // queue can see at a glance which rows are from a restricted
          // partner, without this route handing back anything it
          // wouldn't otherwise.
          isRestricted: !!partnerById.get(row.partnerId)?.isRestricted,
          // #187: whether this row is currently held out of every send
          // path (see notificationFlush.js's own needsReview(), which
          // this must stay consistent with -- restricted real-content
          // row, never yet edited/confirmed).
          needsReview:
            REVIEW_GATED_TYPES.has(row.type) &&
            !!partnerById.get(row.partnerId)?.isRestricted &&
            !row.reviewedAt,
          reviewedAt: row.reviewedAt,
          groupmeSentAt: row.groupmeSentAt,
          emailSentAt: row.emailSentAt,
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
    const row = await prisma.pendingNotification.findUnique({ where: { id: req.params.id } });
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
// also what satisfies notificationFlush.js's needsReview() gate; for
// every other row it's purely a content edit with no send-eligibility
// consequence. Re-callable: saving again overwrites the previous edit.
router.put("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    const row = await prisma.pendingNotification.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.pendingNotification.update({
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

// POST /api/notifications/send -- admin or editor, matches
// routes/inboundEmail.js's own assign-role gating (this files real
// content the same way that does). Calls the exact same flush
// utils/digestScheduler.js's own automatic schedule uses, so a manual
// click and an automatic flush behave identically.
router.post("/send", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    res.json(await flushPendingNotifications());
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/pending/:id -- admin or editor, same gate as
// sending. Discards one queued notification without ever sending it on
// either channel -- e.g. a restricted partner's update that shouldn't go
// out over GroupMe/email at all this round. Irreversible (no undo queue),
// same as deleting any other record in this app.
router.delete("/pending/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const deleted = await prisma.pendingNotification.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
