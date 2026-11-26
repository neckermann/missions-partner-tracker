const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { loadOpenKeyDatesFor } = require("../utils/keyDateQueries");
const { describe, when } = require("../utils/keyDateReminderEmail");

// The key dates coming up for the partners this login looks after, as plain lines. It is what the daily key-date
// email would say, so a church with Email (Sending) off can copy and pass it on (the email-off option for
// key-date reminders). Gated by the keyDates feature (404 when off); everyone who looks after partners may read
// their own, a care team guest included. Names are masked exactly as in the email.
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("keyDates"));
router.use(requireRole("admin", "editor", "viewer", "guest"));

router.get("/mine", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const items = await loadOpenKeyDatesFor(req.user.id);
    items.sort((a, b) => a.daysUntil - b.daysUntil);
    res.json({
      emailOn: isFeatureEnabled(settings?.enabledFeatures, "outboundEmail"),
      items: items.map((i) => ({
        partnerId: i.partnerId,
        when: when(i),
        text: describe(i, settings),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
