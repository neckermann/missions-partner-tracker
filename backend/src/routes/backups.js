const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { recordAudit } = require("../utils/auditLog");
const { requireRole } = require("../middleware/requireAuth");
const { writeBackup } = require("../utils/backup");
const { MIN_PASSPHRASE_LENGTH } = require("../utils/backupCrypto");

// The backup file is the heaviest request and the most sensitive output; this stops a compromised admin session
// pulling it in a loop. Wrong passwords count too. It sits AFTER the admin check and counts per admin account, not
// per address: it used to run first, keyed by address, so five anonymous requests from the same address (a shared
// office network, a scanner) locked the real admin out for 15 minutes. Relaxed under test, like the sign-in limiter.
function createBackupLimiter(max = process.env.NODE_ENV === "test" ? 1000 : 5) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    keyGenerator: (req) => `backups:${req.user.id}`,
  });
}

const router = express.Router();
router.use(requireRole("admin"));
router.use(createBackupLimiter());

const downloadSchema = z.object({
  // The signed-in admin's own password, asked for again: a stolen session alone must not be enough.
  password: z.string().min(1, "Enter your password to download a backup"),
  // Optional. When given, the file is locked with it and cannot be opened without it (and there is no recovery).
  passphrase: z
    .string()
    .min(MIN_PASSPHRASE_LENGTH, `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
    .optional(),
});

// Streams the whole database as a gzipped NDJSON file; nothing is persisted.
//
// The file contains unmasked data for every partner (including restricted ones) and every user's password
// hash and encrypted MFA secret -- the most sensitive export this app can produce. So: POST (a link or a
// prefetch can't trigger it), the admin's password again, an optional passphrase, rate-limited per admin account
// (wrong passwords count against that limit too), and an audit entry either way. The UI carries its own
// warning since nothing here stops an admin sharing the file.
router.post("/download", async (req, res, next) => {
  try {
    const parsed = downloadSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { password, passphrase } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.passwordHash) {
      return res
        .status(400)
        .json({ error: "Set a password on your account (My Account) before downloading a backup" });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await recordAudit(null, { action: "backup.download_refused", actor: req.user, req });
      return res.status(401).json({ error: "That password isn't right" });
    }

    // Streamed: the file is read from the database and sent in pieces as it is made, never held in memory whole
    // (see writeBackup), so photos and files can't run a small server out of memory. The audit entry is written
    // as the download starts, so a client that drops the connection can't skip it; a failure part way through
    // ends the download early, and the half file fails its checksum if anyone tries to restore it.
    const encrypted = Boolean(passphrase);
    await recordAudit(null, {
      action: "backup.downloaded",
      actor: req.user,
      req,
      details: { passphraseProtected: encrypted },
    });
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, "-");
    const filename = encrypted ? `backup-${stamp}.ndjson.gz.locked` : `backup-${stamp}.ndjson.gz`;

    res.setHeader("Content-Type", encrypted ? "application/octet-stream" : "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    try {
      await writeBackup(prisma, res, { passphrase, createdAt });
    } catch (err) {
      if (res.headersSent) {
        console.error("Backup download failed part way:", err.message);
        res.destroy();
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.createBackupLimiter = createBackupLimiter;
