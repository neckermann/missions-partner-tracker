const express = require("express");
const { requireRole } = require("../middleware/requireAuth");
const { detectProvider } = require("../utils/backupCheck");

const router = express.Router();
router.use(requireRole("admin"));

// GET /api/backup-check
// Backs the admin-dashboard backup reminder (see BackupReminder.jsx).
router.get("/", (req, res) => {
  res.json({ provider: detectProvider() });
});

module.exports = router;
