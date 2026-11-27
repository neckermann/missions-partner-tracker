const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { recordAudit } = require("../utils/auditLog");
const { requireRole } = require("../middleware/requireAuth");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const {
  writeBackup,
  verifyBackupFile,
  restoreBackupFile,
  isLockedBackupFile,
  latestMigrationName,
} = require("../utils/backup");
const { MIN_PASSPHRASE_LENGTH } = require("../utils/backupCrypto");
const { beginRestore, endRestore } = require("../utils/restoreLock");
const { refuseOnGuardedDemo } = require("../utils/demoMode");
const { clearAuditEnabledCache } = require("../utils/auditLog");

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

// When each admin last downloaded a backup. A restore asks for one made in the last few minutes, so the person
// has a copy of what is on the site now before it is replaced (in memory: one process serves the site).
const RECENT_COPY_MS = 15 * 60 * 1000;
const lastDownload = new Map();

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
    lastDownload.set(req.user.id, Date.now());
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

// ---------------------------------------------------------------------------------------------------------
// POST /api/backups/restore -- put a downloaded backup back, for a church that cannot run the command line.
//
// This REPLACES everything on the site with the backup's contents, so it is guarded hard:
//   * admin only, never on the public demo, rate-limited per admin with the download;
//   * the admin's password again, and the word RESTORE typed exactly;
//   * a copy of what is on the site NOW, downloaded by this admin in the last 15 minutes (the dialog's first
//     step is that download), so a restore can always be undone;
//   * the uploaded file is kept on disk and read as a stream, never held in memory: its checksum, row counts and
//     (for a locked file) passphrase are checked from start to end BEFORE anything is touched, and so is the
//     database version it was made for (as the command-line restore does);
//   * one restore at a time; while it runs every other write to the site is refused (restoreLock.js) and the
//     scheduled jobs skip their ticks (pausableCron.js);
//   * the replace is one database transaction: any failure, at any row, leaves the existing data exactly as it was;
//   * the result is audited (after the restore, since the audit log is itself restored).
const RESTORE_CONFIRMATION = "RESTORE";
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const uploadBackup = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function refuse(req, res, status, error, reason) {
  return recordAudit(null, { action: "backup.restore_refused", actor: req.user, req, details: { reason } })
    .catch(() => {})
    .then(() => res.status(status).json({ error }));
}

router.post(
  "/restore",
  refuseOnGuardedDemo("Restoring a backup"),
  (req, res, next) =>
    uploadBackup.single("file")(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "That backup is too large to restore from the browser. Use the restore command instead (see the Admin Guide)."
            : "The file couldn't be read.",
      });
    }),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    let holdsLock = false;
    try {
      if (!beginRestore()) {
        return res.status(409).json({ error: "A restore is already running. Wait for it to finish." });
      }
      holdsLock = true;
      const { password, passphrase, confirmation } = req.body || {};
      if (!req.file) return res.status(400).json({ error: "Choose the backup file to restore." });
      if (confirmation !== RESTORE_CONFIRMATION) {
        return res.status(400).json({ error: `Type ${RESTORE_CONFIRMATION} exactly to confirm.` });
      }
      if (!password) return res.status(400).json({ error: "Enter your password to restore a backup." });

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user?.passwordHash) {
        return res
          .status(400)
          .json({ error: "Set a password on your account (My Account) before restoring a backup." });
      }
      if (!(await bcrypt.compare(String(password), user.passwordHash))) {
        return await refuse(req, res, 401, "That password isn't right", "wrong password");
      }

      const copiedAt = lastDownload.get(req.user.id);
      if (!copiedAt || Date.now() - copiedAt > RECENT_COPY_MS) {
        return await refuse(
          req,
          res,
          400,
          "Download a copy of the current data first, so this restore can be undone.",
          "no recent safety copy"
        );
      }

      // Every check that needs no database change, over the whole file, before anything is touched.
      const locked = await isLockedBackupFile(tempPath);
      if (locked && !passphrase) {
        return await refuse(
          req,
          res,
          400,
          "This backup is locked with a passphrase. Enter it to continue.",
          "passphrase needed"
        );
      }
      let manifest;
      try {
        manifest = await verifyBackupFile(tempPath, { passphrase: locked ? String(passphrase) : undefined });
      } catch (err) {
        return await refuse(req, res, 400, err.message, err.message);
      }
      const current = latestMigrationName();
      if (manifest.migrationName !== current) {
        const message = `This backup was made for a different version of the app's database (${manifest.migrationName}, this site is on ${current}), so it can't be restored here.`;
        return await refuse(req, res, 400, message, "different database version");
      }

      const { counts } = await restoreBackupFile(prisma, tempPath, {
        passphrase: locked ? String(passphrase) : undefined,
        skipVerify: true,
        replaceExisting: true,
      });
      clearAuditEnabledCache();

      const restoredRows = Object.values(counts).reduce((a, b) => a + b, 0);
      await recordAudit(null, {
        action: "backup.restored",
        actor: req.user,
        req,
        details: { backupCreatedAt: manifest.createdAt, appVersion: manifest.appVersion, rows: restoredRows },
      });
      res.json({ restored: true, rows: restoredRows });
    } catch (err) {
      next(err);
    } finally {
      if (holdsLock) endRestore();
      if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
    }
  }
);

module.exports = router;
module.exports.createBackupLimiter = createBackupLimiter;
