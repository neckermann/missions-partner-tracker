const express = require("express");
const { getCountryInfo } = require("../utils/joshuaProject");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
// The widget itself already no-ops (returns null/404) with no API key
// configured; this makes a church that's turned the feature off stop
// serving the data at all, same "off means 404, not just hidden" rule
// every other feature gets.
router.use(requireFeature("joshuaProject"));

// GET /api/public/country-info/:countryCode
// Proxies Joshua Project's country-level statistics so the API key never
// reaches the browser. General country demographic/religious data, not
// missionary-specific or sensitive — safe to expose without auth.
router.get("/:countryCode", async (req, res, next) => {
  try {
    const info = await getCountryInfo(req.params.countryCode);
    if (!info) return res.status(404).json({ error: "No country info available" });
    res.json(info);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
