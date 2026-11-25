const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { resolveNotificationSummary, markCategorySeen } = require("../notifications/categories");

// Any logged-in role; the registry in notifications/categories.js decides
// which categories each role's summary includes.
const router = express.Router();
router.use(requireAuth);

router.get("/summary", async (req, res, next) => {
  try {
    const categories = await resolveNotificationSummary({
      userId: req.user.id,
      role: req.user.role,
      scopeTripIds: req.user.role === "guest" ? req.user.tripIds : null,
      // A guest's new-need/prayer counts are limited to their care team partners.
      scopePartnerIds: req.user.role === "guest" ? req.user.careTeamPartnerIds || [] : null,
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// Marks one category seen for the calling user only, never shared.
router.post("/seen", async (req, res, next) => {
  try {
    const category = String(req.body?.category || "");
    if (!category) return res.status(400).json({ error: "category is required" });
    await markCategorySeen(req.user.id, category);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
