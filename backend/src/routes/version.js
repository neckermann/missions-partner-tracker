const express = require("express");
const { requireRole } = require("../middleware/requireAuth");
const { checkForUpdate, APP_VERSION } = require("../utils/versionCheck");

const router = express.Router();
router.use(requireRole("admin"));

// GET /api/version-check
// Backs the "an update is available" banner in the admin dashboard (see
// utils/versionCheck.js). Admin-only, not because the version is
// sensitive, but because it's only ever relevant to whoever manages the
// deployment.
router.get("/", async (req, res, next) => {
  try {
    const result = await checkForUpdate();
    res.json(
      result || {
        currentVersion: APP_VERSION,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
      }
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
