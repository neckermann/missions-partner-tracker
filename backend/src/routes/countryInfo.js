const express = require("express");
const { getCountryInfo } = require("../utils/joshuaProject");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireFeature("joshuaProject"));

// Proxies Joshua Project's country-level statistics so the API key never
// reaches the browser. The data is general, not sensitive, so no auth.
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
