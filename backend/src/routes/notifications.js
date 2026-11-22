const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { resolveNotificationSummary, markCategorySeen } = require("../notifications/categories");

// GET /api/notifications/summary -- any logged-in role; the registry
// itself decides which categories that role's response includes (see
// notifications/categories.js's own header comment for the shared-vs-
// per-user count distinction and the admin-only visibility tier).
const router = express.Router();
router.use(requireAuth);

router.get("/summary", async (req, res, next) => {
  try {
    const categories = await resolveNotificationSummary({ userId: req.user.id, role: req.user.role });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/seen -- marks one category seen for the calling
// user only (never shared -- see categories.js's own reasoning for why).
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
