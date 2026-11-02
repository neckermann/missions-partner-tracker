const express = require("express");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { detectProvider } = require("../utils/backupCheck");

const router = express.Router();
router.use(requireRole("admin"));

// GET /api/backup-check
// Backs the admin-dashboard backup reminder (see BackupReminder.jsx).
// backupReminderDisabled is the deliberate, permanent opt-out set on the
// Backups settings page (AdminSettingsBackups.jsx) -- distinct from that
// component's own per-browser dismiss-for-30-days.
router.get("/", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { backupReminderDisabled: true },
    });
    res.json({
      provider: detectProvider(),
      backupReminderDisabled: Boolean(settings?.backupReminderDisabled),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
