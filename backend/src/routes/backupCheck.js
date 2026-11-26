const express = require("express");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { detectProvider } = require("../utils/backupCheck");

const router = express.Router();
router.use(requireRole("admin"));

// backupReminderDisabled is the permanent opt-out from the Backups settings
// page, distinct from the reminder's per-browser 30-day dismiss.
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
