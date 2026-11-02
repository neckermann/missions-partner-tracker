const express = require("express");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { buildBackup } = require("../utils/backup");

const router = express.Router();
router.use(requireRole("admin"));

// GET /api/backups/download (admin only) -- builds the whole database as a
// gzipped NDJSON file in memory and streams it back as an attachment. No
// persistence: nothing about this request is written anywhere, so there's
// no backup-history table/row to manage, retain, or prune in v1 (see the
// plan on issue #75 for what's deliberately deferred).
//
// The file contains unmasked data for every partner (including restricted
// ones) and every user's password hash and encrypted MFA secret -- the
// most sensitive export this app can produce. Rate-limited in server.js
// like other sensitive admin routes; the UI carries its own warning (see
// AdminSettingsBackups.jsx) since nothing here stops an admin from handing
// the file to someone who shouldn't have it.
router.get("/download", async (req, res, next) => {
  try {
    const { buffer, manifest } = await buildBackup(prisma);
    const filename = `backup-${manifest.createdAt.replace(/[:.]/g, "-")}.ndjson.gz`;

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
