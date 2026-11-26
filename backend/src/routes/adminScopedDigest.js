const express = require("express");
const prisma = require("../prismaClient");
const { DIGEST_ROLES } = require("../utils/digestRoles");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// GET /api/scoped-digest/summary -- aggregate counts only, no email addresses.
// Trip Leaders are excluded for consistency with every other admin-area read.
router.get("/summary", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const [adminSubscribedCount, publicConfirmedCount, publicUnconfirmedCount] = await Promise.all([
      prisma.user.count({
        where: { cadence: { not: null }, active: true, role: { in: DIGEST_ROLES } },
      }),
      prisma.publicSubscriber.count({ where: { confirmedAt: { not: null } } }),
      prisma.publicSubscriber.count({ where: { confirmedAt: null } }),
    ]);
    res.json({ adminSubscribedCount, publicConfirmedCount, publicUnconfirmedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
