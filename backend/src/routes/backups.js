const express = require("express");
const prisma = require("../prismaClient");
const { recordAudit } = require("../utils/auditLog");
const { requireRole } = require("../middleware/requireAuth");
const { buildBackup } = require("../utils/backup");

const router = express.Router();
router.use(requireRole("admin"));

// Builds the whole database as a gzipped NDJSON file in memory and streams it
// back; nothing is persisted.
//
// The file contains unmasked data for every partner (including restricted
// ones) and every user's password hash and encrypted MFA secret -- the most
// sensitive export this app can produce. Rate-limited in server.js; the UI
// carries its own warning since nothing here stops an admin sharing the file.
router.get("/download", async (req, res, next) => {
  try {
    const { buffer, manifest } = await buildBackup(prisma);
    await recordAudit(null, { action: "backup.downloaded", actor: req.user, req });
    const filename = `backup-${manifest.createdAt.replace(/[:.]/g, "-")}.ndjson.gz`;

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
