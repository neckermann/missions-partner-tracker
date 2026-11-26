const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { recordAudit } = require("../utils/auditLog");
const { requireRole } = require("../middleware/requireAuth");
const multer = require("multer");
const {
  buildBackup,
  readBackupFile,
  replaceAllRows,
  RestoreFileError,
  MAX_RESTORE_FILE_BYTES,
} = require("../utils/backup");
const { MIN_PASSPHRASE_LENGTH, encryptBackup } = require("../utils/backupCrypto");
const { beginRestore, endRestore } = require("../utils/restoreLock");
const { refuseOnGuardedDemo } = require("../utils/demoMode");
const { clearAuditEnabledCache } = require("../utils/auditLog");

const router = express.Router();
router.use(requireRole("admin"));

const downloadSchema = z.object({
  // The signed-in admin's own password, asked for again: a stolen session alone must not be enough.
  password: z.string().min(1, "Enter your password to download a backup"),
  // Optional. When given, the file is locked with it and cannot be opened without it (and there is no recovery).
  passphrase: z
    .string()
    .min(MIN_PASSPHRASE_LENGTH, `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
    .optional(),
});

// Builds the whole database as a gzipped NDJSON file in memory and sends it back; nothing is persisted.
//
// The file contains unmasked data for every partner (including restricted ones) and every user's password
// hash and encrypted MFA secret -- the most sensitive export this app can produce. So: POST (a link or a
// prefetch can't trigger it), the admin's password again, an optional passphrase, rate-limited in server.js
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

    const { buffer, manifest } = await buildBackup(prisma);
    const encrypted = Boolean(passphrase);
    await recordAudit(null, {
      action: "backup.downloaded",
      actor: req.user,
      req,
      details: { passphraseProtected: encrypted },
    });
    const stamp = manifest.createdAt.replace(/[:.]/g, "-");
    const filename = encrypted ? `backup-${stamp}.ndjson.gz.locked` : `backup-${stamp}.ndjson.gz`;

    res.setHeader("Content-Type", encrypted ? "application/octet-stream" : "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(encrypted ? encryptBackup(buffer, passphrase) : buffer);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------------------------------------
// POST /api/backups/restore -- put a downloaded backup back, for a church that cannot run the command line.
//
// This REPLACES everything on the site with the backup's contents, so it is guarded hard:
//   * admin only, never on the public demo, rate-limited with the download (server.js);
//   * the admin's password again, and the word RESTORE typed exactly;
//   * the file's checksum, and the database version it was made for, are checked first (as the command-line
//     restore does), and a locked file needs its passphrase;
//   * a copy of the CURRENT data is built before anything is touched, and sent back as this response so the
//     admin can undo the restore; if that copy cannot be built, nothing is restored;
//   * one restore at a time, and while it runs every other write to the site is refused (restoreLock.js);
//   * the replace is one database transaction: any failure, at any row, leaves the existing data exactly as it was;
//   * the result is audited (after the restore, since the audit log is itself restored).
// Too-large files are refused with a pointer to the command, to avoid running a small server out of memory.
const RESTORE_CONFIRMATION = "RESTORE";
const uploadBackup = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESTORE_FILE_BYTES, files: 1 },
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
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      res.status(400).json({
        error: tooBig
          ? "That backup is too large to restore from the browser. Use the restore command instead (see the Admin Guide)."
          : "The file couldn't be read.",
      });
    }),
  async (req, res, next) => {
    if (!beginRestore()) {
      return res.status(409).json({ error: "A restore is already running. Wait for it to finish." });
    }
    try {
      const { password, passphrase, safetyPassphrase, confirmation } = req.body || {};
      if (!req.file) return res.status(400).json({ error: "Choose the backup file to restore." });
      if (confirmation !== RESTORE_CONFIRMATION) {
        return res.status(400).json({ error: `Type ${RESTORE_CONFIRMATION} exactly to confirm.` });
      }
      if (!password) return res.status(400).json({ error: "Enter your password to restore a backup." });
      if (safetyPassphrase && String(safetyPassphrase).length < MIN_PASSPHRASE_LENGTH) {
        return res
          .status(400)
          .json({
            error: `The passphrase for the safety copy must be at least ${MIN_PASSPHRASE_LENGTH} characters.`,
          });
      }

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user?.passwordHash) {
        return res
          .status(400)
          .json({ error: "Set a password on your account (My Account) before restoring a backup." });
      }
      if (!(await bcrypt.compare(String(password), user.passwordHash))) {
        return await refuse(req, res, 401, "That password isn't right", "wrong password");
      }

      let parsed;
      try {
        parsed = readBackupFile(req.file.buffer, { passphrase });
      } catch (err) {
        if (err instanceof RestoreFileError) return await refuse(req, res, 400, err.message, err.message);
        throw err;
      }

      // The safety copy of what is there NOW, built before a single row is touched.
      const safety = await buildBackup(prisma);
      const safetyBytes = safetyPassphrase
        ? encryptBackup(safety.buffer, String(safetyPassphrase))
        : safety.buffer;
      const stamp = safety.manifest.createdAt.replace(/[:.]/g, "-");
      const safetyName = `before-restore-${stamp}.ndjson.gz${safetyPassphrase ? ".locked" : ""}`;

      const counts = await replaceAllRows(prisma, parsed.rowsByModel);
      clearAuditEnabledCache();

      const restoredRows = Object.values(counts).reduce((a, b) => a + b, 0);
      await recordAudit(null, {
        action: "backup.restored",
        actor: req.user,
        req,
        details: {
          backupCreatedAt: parsed.manifest.createdAt,
          appVersion: parsed.manifest.appVersion,
          rows: restoredRows,
          safetyCopyLocked: Boolean(safetyPassphrase),
        },
      });

      res.setHeader("Content-Type", safetyPassphrase ? "application/octet-stream" : "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${safetyName}"`);
      res.setHeader("X-Restored-Rows", String(restoredRows));
      res.send(safetyBytes);
    } catch (err) {
      next(err);
    } finally {
      endRestore();
    }
  }
);

module.exports = router;
