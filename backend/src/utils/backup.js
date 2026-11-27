const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { once } = require("events");
const { pipeline } = require("stream/promises");
const { PassThrough, Readable } = require("stream");
const { Prisma } = require("@prisma/client");
const {
  TAG_LEN,
  V2_HEADER_LEN,
  isEncryptedBackup,
  isV2,
  decryptBackup,
  createLockStream,
  createUnlockStream,
} = require("./backupCrypto");
const { APP_VERSION } = require("./versionCheck");

// MODELS_COMPLETE_ASSERTION below compares this list against every model in
// prisma/schema.prisma (via Prisma.dmmf, read at require time) and throws if
// they drift, so a model can't be silently skipped by backup/restore.
//
// MODELS can't be derived from the DMMF: Prisma 7's runtime DMMF is trimmed
// (no relationFromFields/isRequired), so the FK-safe order restoreRows needs
// can't be determined from it. The order stays hand-maintained.
//
// FK-safe order: parents before children, since restore (scripts/restore-
// backup.js) inserts in this same order.
//
// WhatsAppAuthEntry is deliberately excluded (see EXCLUDED_MODELS): it is live
// credential material for one socket, and a restored copy would fight the real
// session and get it logged out. After a restore the admin re-pairs.
//
// A *Bytes table (partnerFileBytes, photoBytes, churchSettingsLogo,
// tripParticipantPhoto, tripDocumentBytes, inboundEmailBytes) sits immediately
// after its parent: its id doubles as its FK into that parent.
const MODELS = [
  "partner",

  // The Trip sub-resource tree, right after partner (trip.partnerId is nullable
  // but a real FK when set). tripApplication precedes tripParticipant because an
  // approved participant carries applicationId.
  "trip",
  "tripApplication",
  "applicationQuestion", // -> trip
  "tripApplicationAnswer", // -> tripApplication, applicationQuestion
  "requirementTemplateItem",
  "tripParticipant",
  "tripParticipantPhoto",
  "tripMeeting",
  "tripMeetingRsvp", // needs both tripMeeting and tripParticipant
  "tripRequirement",
  "tripRequirementStatus", // needs both tripRequirement and tripParticipant
  "tripDocument", // optional FKs into trip/tripParticipant/tripRequirement
  "tripDocumentBytes",
  "tripContribution",
  "tripBudgetLine",
  "tripFlightSegment",

  // Partner's other direct children: no FKs into each other, so order among them is free.
  "adult",
  "child",
  "address",
  "furlough",
  "churchVisit",
  "sendingParty",
  "partnerLink",
  "partnerLanguage",
  "tripType",

  // partnerFile precedes supportNeed/prayerRequest: they have a non-deferrable
  // FK into it (sourceFileId) inside the same restore transaction.
  "partnerFile",
  "partnerFileBytes",
  "supportEntry",
  "supportNeed",
  "prayerRequest",
  "photo",
  "photoBytes",

  // Standalone: no FK into partner or anything above.
  "inboundEmail",
  "inboundEmailBytes",
  "inboundEmailFailure",

  "dispatchRecord",

  "churchSettings",
  "churchSettingsLogo",

  "user",
  "tripAccess", // -> user, trip
  "userPasskey", // -> user
  "userRecoveryCode", // -> user (hashes only)
  "careTeamMember", // -> partner, user
  "contactLog", // -> partner, user
  "keyDateReminder", // -> partner, user
  "careChatPost", // -> partner
  "supportOption", // standalone: the church's menu
  "partnerSupportPreference", // -> partner, supportOption
  "survey", // standalone: the church's surveys
  "surveyQuestion", // -> survey
  "surveyInvite", // -> survey, partner (token hash only)
  "surveyResponse", // -> survey, partner
  "surveyAnswer", // -> surveyResponse, surveyQuestion
  "surveyUpload", // -> surveyResponse, partner, surveyQuestion (photo bytes awaiting approval)
  "surveyProposal", // -> survey, surveyResponse, partner, surveyQuestion, surveyUpload
  "auditLog", // standalone: ids and snapshots, no FKs
  "savedReport", // savedReport.ownerId -> user
  "reportSchedule", // reportSchedule.savedReportId -> savedReport
  "passwordSetupToken", // -> user
  "signInLinkToken", // -> user
  "notificationSeen", // -> user
  "userFollowedPartner", // -> user, partner
  "publicSubscriber",
  "publicSubscriberPartner", // -> publicSubscriber, partner
];

// Models that must never be backed up or restored. Anything NOT in this set
// must appear in MODELS, or MODELS_COMPLETE_ASSERTION throws at require time.
const EXCLUDED_MODELS = new Set([
  // Live WhatsApp (Baileys) session/credential state tied to one running socket.
  "WhatsAppAuthEntry",
  // Used passkey challenges: seconds-lived security state, deleted as it expires.
  "SpentPasskeyChallenge",
]);

// Prisma exposes each model under the camelCase of its schema name (TripMeeting -> prisma.tripMeeting).
function clientAccessorName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

// Every model in prisma/schema.prisma, read via Prisma.dmmf rather than by hand.
const SCHEMA_MODEL_NAMES = new Set(
  Prisma.dmmf.datamodel.models
    .map((m) => m.name)
    .filter((name) => !EXCLUDED_MODELS.has(name))
    .map(clientAccessorName)
);

// Runs at require time so a model added to schema.prisma without updating this
// file fails at boot/test/restore instead of silently never being backed up.
(function assertModelsComplete() {
  const missing = [...SCHEMA_MODEL_NAMES].filter((n) => !MODELS.includes(n));
  const stale = MODELS.filter((n) => !SCHEMA_MODEL_NAMES.has(n));
  if (missing.length || stale.length) {
    throw new Error(
      "backup.js's MODELS list has drifted from prisma/schema.prisma. " +
        (missing.length
          ? `Missing from MODELS (add in FK-safe order, or exclude with a reason in EXCLUDED_MODELS): ${missing.join(", ")}. `
          : "") +
        (stale.length ? `In MODELS but no longer in the schema: ${stale.join(", ")}.` : "")
    );
  }
})();

// Prisma returns a Node Buffer for every `Bytes` column. JSON.stringify would
// bloat it ~4x ({type:"Buffer",data:[...]}), so these are base64-encoded
// (~1.33x) and decoded on restore.
//
// Read from the schema (Prisma.dmmf), not listed by hand: a hand-kept list let
// surveyUpload.bytes be left out, which made every restore fail on that table.
// Any new Bytes column is picked up automatically.
const BYTES_FIELDS = {};
for (const model of Prisma.dmmf.datamodel.models) {
  if (EXCLUDED_MODELS.has(model.name)) continue;
  const fields = model.fields.filter((f) => f.type === "Bytes").map((f) => f.name);
  if (fields.length) BYTES_FIELDS[clientAccessorName(model.name)] = fields;
}

function encodeBytesFields(model, row) {
  const fields = BYTES_FIELDS[model];
  if (!fields) return row;
  const copy = { ...row };
  for (const field of fields) {
    // Prisma 7's driver-adapter client returns a plain Uint8Array for Bytes, not
    // a Buffer, so Buffer.isBuffer() would skip encoding. Buffer subclasses
    // Uint8Array, so this covers both.
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

// The newest migration folder, read from disk rather than the live
// _prisma_migrations table: restore must compare against the code's migration
// state, not whatever the source database had applied.
function latestMigrationName() {
  const dir = path.join(__dirname, "..", "..", "prisma", "migrations");
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return entries[entries.length - 1] || null;
}

// ---- Streaming build ------------------------------------------------------------------------------------
//
// The backup is never held in memory as a whole. Rows are read a batch at a time and turned into one JSON line
// each; the file is the manifest line followed by those lines (see writeBackup). A photo is megabytes and is
// base64-encoded, so tables with a Bytes column are read a few rows at a time, the others in larger batches.
const BATCH_ROWS = 200;
const BATCH_ROWS_WITH_BYTES = 4;

// Each table's primary-key columns, read once from the database (Prisma 7's runtime DMMF no longer says). A
// batch is ordered by them, so the same query returns the same rows in the same order every time.
const primaryKeys = new Map();
async function primaryKeyOf(db, model) {
  if (primaryKeys.has(model)) return primaryKeys.get(model);
  const table = Prisma.dmmf.datamodel.models.find((m) => clientAccessorName(m.name) === model);
  const name = table?.dbName || table?.name;
  const rows = await db.$queryRaw`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary AND i.indrelid = ${`"${name}"`}::regclass
    ORDER BY array_position(i.indkey::int2[], a.attnum)`;
  const columns = rows.map((r) => r.column_name);
  if (!columns.length) throw new Error(`Couldn't find the primary key of ${name} for the backup`);
  primaryKeys.set(model, columns);
  return columns;
}

// One JSON line per row of `model`, in primary-key order, read in batches.
async function* modelLines(db, model) {
  const pk = await primaryKeyOf(db, model);
  const take = BYTES_FIELDS[model] ? BATCH_ROWS_WITH_BYTES : BATCH_ROWS;
  const orderBy = pk.map((c) => ({ [c]: "asc" }));
  let cursor = null;
  for (let skip = 0; ; skip += take) {
    // One-column keys page by cursor (cheap however far in); a composite key, only on small tables, by offset.
    const page =
      pk.length === 1
        ? await db[model].findMany({ orderBy, take, ...(cursor ? { cursor, skip: 1 } : {}) })
        : await db[model].findMany({ orderBy, take, skip });
    for (const row of page) yield JSON.stringify({ model, row: encodeBytesFields(model, row) });
    if (page.length < take) return;
    cursor = { [pk[0]]: page[page.length - 1][pk[0]] };
  }
}

// Writes `text` to a stream and waits if it is full, so memory stays flat however slowly the other end reads.
async function writeTo(stream, text) {
  if (!stream.write(text)) await once(stream, "drain");
}

// Streams the whole database into `out` (any Writable: the HTTP response, a file) as a gzipped NDJSON backup, or
// as a locked file when `passphrase` is given. The file is: one manifest line (app version, migration name,
// timestamp, per-model row counts, sha256 of every following line), then one JSON line per row tagged with its
// model, in restore order. The manifest comes first and holds the checksum and the counts, so the database is
// read twice inside ONE snapshot (a repeatable-read transaction, so the second read sees exactly what the first
// did): the first pass counts and hashes the lines without keeping them, the second writes them.
//
// `createdAt` is the stamp for the manifest (the route needs it for the file name before anything is sent).
// `afterCount` is a hook for tests, called between the two passes.
async function writeBackup(
  prisma,
  out,
  { passphrase, createdAt = new Date().toISOString(), afterCount } = {}
) {
  return prisma.$transaction(
    async (tx) => {
      const rowCounts = Object.fromEntries(MODELS.map((m) => [m, 0]));
      const hash = crypto.createHash("sha256");
      let first = true;
      for (const model of MODELS) {
        for await (const line of modelLines(tx, model)) {
          hash.update(first ? line : "\n" + line);
          first = false;
          rowCounts[model] += 1;
        }
      }
      const manifest = {
        manifest: true,
        appVersion: APP_VERSION,
        migrationName: latestMigrationName(),
        createdAt,
        rowCounts,
        checksum: hash.digest("hex"),
      };
      if (afterCount) await afterCount();

      const gzip = zlib.createGzip();
      const stages = passphrase ? [gzip, createLockStream(passphrase), out] : [gzip, out];
      const finished = pipeline(...stages);
      try {
        await writeTo(gzip, JSON.stringify(manifest));
        for (const model of MODELS) {
          for await (const line of modelLines(tx, model)) await writeTo(gzip, "\n" + line);
        }
        gzip.end();
      } catch (err) {
        gzip.destroy(err);
      }
      await finished;
      return { manifest };
    },
    { isolationLevel: "RepeatableRead", maxWait: 60 * 1000, timeout: 30 * 60 * 1000 }
  );
}

// The whole backup as a gzipped buffer, for the places that want one in memory (tests, a safety copy): the same
// bytes writeBackup produces, collected. Memory is the size of the file, not several times it.
async function buildBackup(prisma) {
  const sink = new PassThrough();
  const chunks = [];
  sink.on("data", (c) => chunks.push(c));
  const { manifest } = await writeBackup(prisma, sink);
  return { buffer: Buffer.concat(chunks), manifest };
}

// Parses decompressed backup text into manifest and per-model rows, verifying
// the checksum first so a corrupt or edited file fails before any row is written.
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

// Inserts every parsed row in FK-safe order inside one transaction; shared by
// scripts/restore-backup.js and its test.
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

// ---- Streaming restore ----------------------------------------------------------------------------------
//
// A backup file is read as a stream too, so restoring never holds it in memory either. It is read twice: the
// first pass checks everything (the checksum, the row counts, and for a locked file the passphrase and that
// it wasn't changed) before ANY row is written, exactly as parseBackup always did; the second inserts.

// True when the file at `filePath` is locked with a passphrase (either layout).
async function isLockedBackupFile(filePath) {
  const fd = await fsp.open(filePath, "r");
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await fd.read(head, 0, head.length, 0);
    return isEncryptedBackup(head.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

// The plain (gunzipped) text of a backup file as a Readable. A locked v2 file is unlocked as it is read; an
// older locked (v1) file has its tag in front, so it is opened in memory as it always was.
async function openBackupFile(filePath, { passphrase } = {}) {
  const gunzip = zlib.createGunzip();
  const text = new PassThrough();
  const locked = await isLockedBackupFile(filePath);
  let source;
  if (!locked) {
    source = [fs.createReadStream(filePath), gunzip, text];
  } else {
    if (!passphrase)
      throw new Error("This backup is protected with a passphrase, which is needed to open it");
    const fd = await fsp.open(filePath, "r");
    try {
      const { size } = await fd.stat();
      const head = Buffer.alloc(V2_HEADER_LEN);
      await fd.read(head, 0, head.length, 0);
      if (isV2(head)) {
        const tag = Buffer.alloc(TAG_LEN);
        await fd.read(tag, 0, TAG_LEN, size - TAG_LEN);
        const ciphertext = fs.createReadStream(filePath, { start: V2_HEADER_LEN, end: size - TAG_LEN - 1 });
        source = [ciphertext, createUnlockStream(passphrase, head, tag), gunzip, text];
      } else {
        source = [Readable.from([decryptBackup(await fsp.readFile(filePath), passphrase)]), gunzip, text];
      }
    } finally {
      await fd.close();
    }
  }
  // Any failure in the chain destroys `text` with that error, which whoever reads it receives (the pipeline's own
  // promise is only here so it never goes unhandled). `text.locked` lets the reader say what a failure on a
  // locked file means.
  pipeline(...source).catch(() => {});
  text.locked = locked;
  return text;
}

// The non-empty lines of a stream of text, one at a time, without ever joining the whole thing (a photo's line
// can be many megabytes, so pieces are collected and joined once per line).
async function* linesOf(stream) {
  stream.setEncoding("utf8");
  let pending = [];
  try {
    for await (const chunk of stream) {
      let start = 0;
      let at;
      while ((at = chunk.indexOf("\n", start)) >= 0) {
        pending.push(chunk.slice(start, at));
        const line = pending.join("");
        pending = [];
        if (line) yield line;
        start = at + 1;
      }
      pending.push(chunk.slice(start));
    }
  } catch (err) {
    // A locked file read with a wrong passphrase, or changed, decrypts to garbage before the final check can
    // fail, and the first thing to notice is the gunzip stage; say what actually happened.
    throw stream.locked ? new Error("Wrong passphrase, or the backup file was changed") : err;
  }
  const last = pending.join("");
  if (last) yield last;
}

const readBackupLines = async function* (filePath, opts) {
  yield* linesOf(await openBackupFile(filePath, opts));
};

// Reads the whole file once and throws unless it is a sound backup: a manifest first, a checksum and per-model
// row counts that match what follows, only known models, and (locked) the right passphrase and an unchanged
// file. Returns the manifest. Nothing is written anywhere.
async function verifyBackupFile(filePath, opts = {}) {
  try {
    return await verifyBackupFileUnwrapped(filePath, opts);
  } catch (err) {
    // The decompressor's own words ("incorrect data check", "unexpected end of file") mean a damaged or cut-short file.
    if (/^Z_|data check|header check|unexpected end of file/i.test(`${err.code || ""} ${err.message}`)) {
      throw new Error(`This backup file is damaged or incomplete (${err.message})`);
    }
    throw err;
  }
}

async function verifyBackupFileUnwrapped(filePath, opts) {
  let manifest = null;
  const hash = crypto.createHash("sha256");
  const counts = {};
  let first = true;
  for await (const line of readBackupLines(filePath, opts)) {
    if (!manifest) {
      manifest = JSON.parse(line);
      if (!manifest.manifest) throw new Error("First line isn't a valid backup manifest");
      continue;
    }
    hash.update(first ? line : "\n" + line);
    first = false;
    // A row line starts {"model":"name",... (writeBackup builds it that way), so the model is read without
    // parsing a photo's megabytes of base64.
    const model = /^\{"model":"([A-Za-z]+)"/.exec(line)?.[1];
    if (!model || !MODELS.includes(model)) throw new Error(`Unknown model in backup file: ${model ?? "?"}`);
    counts[model] = (counts[model] || 0) + 1;
  }
  if (!manifest) throw new Error("Empty backup file");
  if (hash.digest("hex") !== manifest.checksum) {
    throw new Error("Checksum mismatch -- this backup file is corrupted or was edited");
  }
  for (const [model, expected] of Object.entries(manifest.rowCounts || {})) {
    if ((counts[model] || 0) !== expected) {
      throw new Error(
        `Backup file doesn't match its manifest: ${model} has ${counts[model] || 0} rows, expected ${expected}`
      );
    }
  }
  return manifest;
}

// Inserts every row of a backup file in FK-safe order inside one transaction, a row at a time as it is read
// (the file is already in restore order). The file is verified first, so a bad file changes nothing.
// `filter(model, row)` restores only the rows it accepts (the tests use it to restore a few).
// `replaceExisting` deletes every backed-up table's rows first, in the same transaction (a full replace).
// Returns { manifest, counts }.
async function restoreBackupFile(
  prisma,
  filePath,
  { passphrase, filter, skipVerify, replaceExisting, timeout = 10 * 60 * 1000 } = {}
) {
  const manifest = skipVerify ? null : await verifyBackupFile(filePath, { passphrase });
  const counts = Object.fromEntries(MODELS.map((m) => [m, 0]));
  await prisma.$transaction(
    async (tx) => {
      // A full replace (the in-app restore): everything now on the site goes first, children before parents, in
      // this same transaction, so a failure at any row puts all of it back. WhatsApp session state and spent
      // passkey challenges are not part of a backup and are left alone.
      if (replaceExisting) {
        for (const model of [...MODELS].reverse()) await tx[model].deleteMany({});
      }
      let skippedManifest = false;
      for await (const line of readBackupLines(filePath, { passphrase })) {
        if (!skippedManifest) {
          skippedManifest = true;
          continue;
        }
        const { model, row } = JSON.parse(line);
        if (filter && !filter(model, row)) continue;
        await tx[model].create({ data: decodeBytesFields(model, row) });
        counts[model] += 1;
      }
    },
    { timeout }
  );
  return { manifest, counts };
}

module.exports = {
  MODELS,
  BYTES_FIELDS,
  encodeBytesFields,
  decodeBytesFields,
  buildBackup,
  writeBackup,
  parseBackup,
  restoreRows,
  isLockedBackupFile,
  openBackupFile,
  verifyBackupFile,
  restoreBackupFile,
  latestMigrationName,
};
