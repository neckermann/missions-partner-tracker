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
// harmless" reasoning as GET /api/newsletters/GET /api/inbound-email.
// Reuses buildBlurb so the admin sees the exact same summary text that
// would actually go out, not a second, hand-maintained description of
// it.
router.get("/pending", async (req, res, next) => {
  try {
    const rows = await prisma.pendingNotification.findMany({ orderBy: { createdAt: "asc" } });
    const items = rows
      .map((row) => {
        const blurb = buildBlurb(row);
        if (!blurb) return null;
        return {
          ...blurb,
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

module.exports = router;
