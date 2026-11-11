const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { APP_VERSION } = require("./versionCheck");

// FK-safe order: parents before children, since restore (scripts/restore-
// backup.js) inserts in this same order and a child row references its
// parent's id. Partner is the root; everything else hangs off partnerId
// directly except TripParticipant, which hangs off Trip. ChurchSettings
// and User have no FK to Partner and could restore in any position, but
// are listed last for clarity.
//
// partnerFile sits *before* supportNeed/prayerRequest, not after --
// those two have a non-deferrable FK into it (sourceFileId), so it must
// already exist by the time a request/need referencing one is inserted
// inside this same transaction (see restore-backup.js's restoreRows).
//
// WhatsAppAuthEntry (the WhatsApp session) is deliberately NOT here: it's
// live credential material tied to one running socket, and a restored copy
// would be stale at best -- or, restored onto a second instance, fight the
// real session and get it logged out. After a restore the admin re-pairs
// (the app notices the missing session and clears the "paired" state on
// its own -- see whatsappClient.js).
const MODELS = [
  "partner",
  "adult",
  "child",
  "address",
  "trip",
  "tripParticipant",
  "furlough",
  "churchVisit",
  "sendingParty",
  "partnerFile",
  "supportEntry",
  "supportNeed",
  "prayerRequest",
  "photo",
  "churchSettings",
  "user",
];

// Prisma returns a Node Buffer for every `Bytes` column -- JSON.stringify
// on a Buffer produces a bulky {type:"Buffer",data:[...]} array of byte
// values (roughly 4x the original size), so these are base64-encoded
// explicitly instead (roughly 1.33x) and decoded back to a Buffer on
// restore.
const BYTES_FIELDS = {
  partnerFile: ["bytes"],
  photo: ["bytes"],
  churchSettings: ["logoBytes"],
};

function encodeBytesFields(model, row) {
  const fields = BYTES_FIELDS[model];
  if (!fields) return row;
  const copy = { ...row };
  for (const field of fields) {
    // Prisma 7's driver-adapter client returns a plain Uint8Array for a
    // Bytes column, not a Node Buffer -- Buffer.isBuffer() on one of those
    // is false, which silently skipped this encoding and let a raw
    // Uint8Array through to JSON.stringify (producing a bulky
    // {"0":70,"1":114,...} object with no way back to binary). Buffer is
    // itself a Uint8Array subclass, so this check covers both.
    if (copy[field] instanceof Uint8Array) copy[field] = Buffer.from(copy[field]).toString("base64");
  }
  return copy;
}

function decodeBytesFields(model, row) {
  const fields = BYTES_FIELDS[model];
  if (!fields) return row;
  const copy = { ...row };
  for (const field of fields) {
    if (typeof copy[field] === "string") copy[field] = Buffer.from(copy[field], "base64");
  }
  return copy;
}

// The migration folder Prisma most recently created, read straight off
// disk rather than queried from the live DB's _prisma_migrations table --
// this reflects the *code's* migration state at backup time, which is
// what restore needs to compare against (the code it's running at restore
// time), not whatever the source database happened to already have
// applied when the backup was taken.
function latestMigrationName() {
  const dir = path.join(__dirname, "..", "..", "prisma", "migrations");
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return entries[entries.length - 1] || null;
}

// Builds the full backup as a gzipped buffer: one manifest line (app
// version, migration name, timestamp, per-model row counts, a sha256
// checksum of every line that follows) followed by one JSON line per row,
// each tagged with which model it belongs to. Export order doesn't
// strictly need to be FK-safe the way restore does, but using the same
// order keeps the file easy to reason about either direction.
async function buildBackup(prisma) {
  const rowCounts = {};
  const dataLines = [];

  for (const model of MODELS) {
    const rows = await prisma[model].findMany();
    rowCounts[model] = rows.length;
    for (const row of rows) {
      dataLines.push(JSON.stringify({ model, row: encodeBytesFields(model, row) }));
    }
  }

  const body = dataLines.join("\n");
  const checksum = crypto.createHash("sha256").update(body).digest("hex");

  const manifest = {
    manifest: true,
    appVersion: APP_VERSION,
    migrationName: latestMigrationName(),
    createdAt: new Date().toISOString(),
    rowCounts,
    checksum,
  };

  const full = JSON.stringify(manifest) + (body ? "\n" + body : "");
  const buffer = zlib.gzipSync(Buffer.from(full, "utf8"));

  return { buffer, manifest };
}

// Parses a (decompressed) backup file's text content back into its
// manifest and per-model rows, verifying the checksum before returning
// anything -- a corrupted or hand-edited file should fail loudly here,
// not partway through a restore with some rows already written.
function parseBackup(text) {
  const lines = text.split("\n").filter(Boolean);
  if (!lines.length) throw new Error("Empty backup file");

  const manifest = JSON.parse(lines[0]);
  if (!manifest.manifest) throw new Error("First line isn't a valid backup manifest");

  const body = lines.slice(1).join("\n");
  const checksum = crypto.createHash("sha256").update(body).digest("hex");
  if (checksum !== manifest.checksum) {
    throw new Error("Checksum mismatch -- this backup file is corrupted or was edited");
  }

  const rowsByModel = Object.fromEntries(MODELS.map((m) => [m, []]));
  for (const line of lines.slice(1)) {
    const { model, row } = JSON.parse(line);
    if (!rowsByModel[model]) throw new Error(`Unknown model in backup file: ${model}`);
    rowsByModel[model].push(decodeBytesFields(model, row));
  }

  return { manifest, rowsByModel };
}

// Inserts every row from a parsed backup (parseBackup's rowsByModel) in
// FK-safe order, inside a single transaction -- shared by scripts/restore-
// backup.js and its own test, rather than duplicating the insert loop or
// having the test shell out to the CLI script.
async function restoreRows(prisma, rowsByModel, { timeout = 10 * 60 * 1000 } = {}) {
  const counts = {};
  await prisma.$transaction(
    async (tx) => {
      for (const model of MODELS) {
        const rows = rowsByModel[model] || [];
        for (const row of rows) {
          await tx[model].create({ data: row });
        }
        counts[model] = rows.length;
      }
    },
    { timeout }
  );
  return counts;
}

module.exports = { MODELS, buildBackup, parseBackup, restoreRows, latestMigrationName };
