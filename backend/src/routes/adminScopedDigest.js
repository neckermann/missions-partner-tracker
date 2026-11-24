const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// GET /api/scoped-digest/summary -- counts only, no email addresses, for
// the admin-visible "how many people are on this" view (#202). Full
// subscriber management (search/remove by email) is a later phase, not
// this one. #327 Finding 2 (lower-value gap): the data itself is harmless
// (three aggregate integers, no PII), but there's no legitimate Trip
// Leader use for it either -- excluded for consistency with every other
// admin-area read, not because this one leaked anything real.
router.get("/summary", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const [adminSubscribedCount, publicConfirmedCount, publicUnconfirmedCount] = await Promise.all([
      prisma.user.count({ where: { cadence: { not: null }, active: true } }),
      prisma.publicSubscriber.count({ where: { confirmedAt: { not: null } } }),
      prisma.publicSubscriber.count({ where: { confirmedAt: null } }),
    ]);
    res.json({ adminSubscribedCount, publicConfirmedCount, publicUnconfirmedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
