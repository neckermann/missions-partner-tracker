const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { buildBlurb } = require("../utils/notificationBlurbs");
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
