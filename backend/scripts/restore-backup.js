// Restores a database backup produced by GET /api/backups/download (see
// src/utils/backup.js and ADMIN_GUIDE.md § Database backups). CLI only,
// deliberately -- no UI restore button exists yet, since an untested
// restore path makes the backup button theater. Run from backend/:
//
//   npm run backup:restore -- <path-to-backup-file.ndjson.gz>
//   npm run backup:restore -- <path> --force   (see the two checks below)
//
// Safety checks, both bypassable only with --force:
//   1. The backup's recorded migration doesn't match this code's current
//      migration -- restoring into a schema the backup wasn't made for is
//      how you corrupt a database, not recover one.
//   2. The target database isn't empty -- this is a full replace, not a
//      merge; anything already there would collide with restored ids or
//      be silently left behind alongside them.
// The checksum in the file itself is always verified, --force or not --
// that's not a safety margin to override, it's "is this file what it
// claims to be" at all.
require("dotenv").config({ quiet: true });
const fs = require("fs");
const zlib = require("zlib");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { parseBackup, restoreRows, latestMigrationName } = require("../src/utils/backup");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: node scripts/restore-backup.js <path-to-backup-file> [--force]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading ${filePath}...`);
  const gzipped = fs.readFileSync(filePath);
  const text = zlib.gunzipSync(gzipped).toString("utf8");

  // parseBackup verifies the checksum itself and throws if it doesn't
  // match -- that check is never skippable, --force or not.
  const { manifest, rowsByModel } = parseBackup(text);
  console.log(`Backup created ${manifest.createdAt}, app version ${manifest.appVersion}.`);

  const currentMigration = latestMigrationName();
  if (manifest.migrationName !== currentMigration) {
    const message = `Backup's migration (${manifest.migrationName}) doesn't match this code's migration (${currentMigration}).`;
    if (!force) {
      console.error(`${message} Refusing to restore -- rerun with --force if you're sure.`);
      process.exit(1);
    }
    console.warn(`${message} Continuing anyway (--force).`);
  }

  const existingPartners = await prisma.partner.count();
  const existingUsers = await prisma.user.count();
  if (existingPartners > 0 || existingUsers > 0) {
    const message = `Target database isn't empty (${existingPartners} partner(s), ${existingUsers} user(s) already on file).`;
    if (!force) {
      console.error(`${message} Refusing to restore -- rerun with --force if you're sure.`);
      process.exit(1);
    }
    console.warn(`${message} Continuing anyway (--force).`);
  }

  console.log("Restoring...");
  const counts = await restoreRows(prisma, rowsByModel);
  for (const [model, count] of Object.entries(counts)) {
    console.log(`  ${model}: ${count} row(s)`);
  }

  console.log("Restore complete.");
  console.log(
    "If this backup's encrypted fields (MFA secrets, GroupMe/Joshua Project/Anthropic API keys) were\n" +
      "created under a different FIELD_ENCRYPTION_KEY than this environment's, those specific values\n" +
      "won't decrypt -- MFA will need re-enrolling and those integrations' keys re-entering. Nothing\n" +
      "else is affected; password hashes aren't tied to FIELD_ENCRYPTION_KEY at all."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
