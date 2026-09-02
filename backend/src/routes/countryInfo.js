const express = require("express");
const { getCountryInfo } = require("../utils/joshuaProject");

const router = express.Router();

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
