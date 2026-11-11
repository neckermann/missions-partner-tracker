const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth); // any logged-in role -- read-only, same "viewing is harmless" reasoning as GET /api/dispatches/pending

// GET /api/scoped-digest/summary -- counts only, no email addresses, for
// the admin-visible "how many people are on this" view (#202). Full
// subscriber management (search/remove by email) is a later phase, not
// this one.
router.get("/summary", async (req, res, next) => {
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
