const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { APP_VERSION } = require("./versionCheck");

// #271 Finding 8: this list used to be 19 hand-maintained names while the
// schema grew to 44 real models -- the other 25 (the entire Trip
// sub-resource tree, DispatchRecord, SavedReport/ReportSchedule,
// PasswordSetupToken, the public-subscriber tables, ...) were silently
// skipped by every backup/restore, with no error. A model can no longer
// fall off the *list* that way: MODELS_COMPLETE_ASSERTION below compares
// this file's own MODELS against every model prisma/schema.prisma
// actually declares (via Prisma.dmmf, read fresh at require time) and
// throws loudly if they've drifted, before this module is even usable.
//
// This can't derive MODELS itself from the DMMF, though -- only the *set*
// of models, not the FK-safe *order* restoreRows needs to insert them in.
// Prisma 7's runtime DMMF is deliberately trimmed for bundle size: each
// field here is just { name, kind, type, relationName } -- no
// relationFromFields/relationToFields/isRequired, so there's no reliable
// way to tell "A has a column that points at B" apart from "B has a
// column that points at A" from this object alone. Guessing a direction
// from relationName's own "AToB" text would be exactly the kind of
// fragile, undocumented-internal-format assumption worth avoiding, so the
// order below stays hand-maintained, verified by hand against
// schema.prisma (see the comments inline), and backed by the completeness
// assertion so at least *membership* can never drift unnoticed again.
//
// FK-safe order: parents before children, since restore (scripts/restore-
// backup.js) inserts in this same order and a child row references its
// parent's id.
//
// WhatsAppAuthEntry is the one model deliberately excluded (see
// EXCLUDED_MODELS below), not just left off by omission -- it's live
// credential material tied to one running socket, and a restored copy
// would be stale at best -- or, restored onto a second instance, fight the
// real session and get it logged out. After a restore the admin re-pairs
// (the app notices the missing session and clears the "paired" state on
// its own -- see whatsappClient.js).
//
// A *Bytes table (partnerFileBytes, photoBytes, churchSettingsLogo,
// tripParticipantPhoto, tripDocumentBytes, inboundEmailBytes) always sits
// immediately after its own parent model -- same FK-safe reasoning, one
// level down: its id doubles as its FK into that parent, which must
// already exist by the time restoreRows gets to it.
const MODELS = [
  "partner",

  // The whole Trip sub-resource tree -- grouped here, right after
  // partner (trip.partnerId is nullable but still a real FK when set),
  // rather than interleaved with partner's other direct children below.
  // tripApplication before tripParticipant: a participant created via
  // application approval carries applicationId pointing at its own
  // application row, which must already exist.
  "trip",
  "tripApplication",
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

  // Partner's other direct children -- no FKs into each other, so their
  // relative order among themselves doesn't matter.
  "adult",
  "child",
  "address",
  "furlough",
  "churchVisit",
  "sendingParty",
  "partnerLink",
  "partnerLanguage",
  "tripType",

  // partnerFile sits *before* supportNeed/prayerRequest, not after --
  // those two have a non-deferrable FK into it (sourceFileId), so it must
  // already exist by the time a request/need referencing one is inserted
  // inside this same transaction (see restoreRows below).
  "partnerFile",
  "partnerFileBytes",
  "supportEntry",
  "supportNeed",
  "prayerRequest",
  "photo",
  "photoBytes",

  // Standalone -- no FK into partner or anything else above.
  "inboundEmail",
  "inboundEmailBytes",
  "inboundEmailFailure",

  "dispatchRecord",

  "churchSettings",
  "churchSettingsLogo",

  "user",
  "tripAccess", // -> user, trip (#356)
  "userPasskey", // -> user (#386)
  "careTeamMember", // -> partner, user (#289)
  "contactLog", // -> partner, user (#288)
  "keyDateReminder", // -> partner, user (#291)
  "supportOption", // standalone: the church's menu (#374)
  "partnerSupportPreference", // -> partner, supportOption (#374)
  "auditLog", // standalone: ids and snapshots, no FKs (#341)
  "savedReport", // savedReport.ownerId -> user
  "reportSchedule", // reportSchedule.savedReportId -> savedReport
  "passwordSetupToken", // -> user
  "notificationSeen", // -> user
  "userFollowedPartner", // -> user, partner
  "publicSubscriber",
  "publicSubscriberPartner", // -> publicSubscriber, partner
];

// Models that exist in the schema but must never be backed up or
// restored -- see each one's own comment for why. Anything NOT in this
// set must appear in MODELS above, or MODELS_COMPLETE_ASSERTION below
// throws at require time.
const EXCLUDED_MODELS = new Set([
  // Live WhatsApp (Baileys) session/credential state tied to one running
  // socket -- see schema.prisma's own comment on this model, and MODELS'
  // comment above.
  "WhatsAppAuthEntry",
]);

// Prisma's generated client exposes each model under the camelCase of
// its schema name (e.g. "TripMeeting" -> prisma.tripMeeting) -- verified
// directly against this repo's actual @prisma/client output, not assumed.
function clientAccessorName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

// The authoritative "what models exist right now" list, read straight off
// prisma/schema.prisma via Prisma.dmmf -- not re-derived by hand, so it
// can never itself be the thing that's out of date.
const SCHEMA_MODEL_NAMES = new Set(
  Prisma.dmmf.datamodel.models
    .map((m) => m.name)
    .filter((name) => !EXCLUDED_MODELS.has(name))
    .map(clientAccessorName)
);

// Runs once, at require time -- fails the moment this module is loaded
// (backend boot, a test file, scripts/restore-backup.js) rather than
// partway through an actual backup/restore. This is the guard against a
// repeat of #271 Finding 8: add model #46 to schema.prisma without
// touching this file, and every build/boot that requires backup.js now
// throws instead of the new table just silently never getting backed up.
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

// Prisma returns a Node Buffer for every `Bytes` column -- JSON.stringify
// on a Buffer produces a bulky {type:"Buffer",data:[...]} array of byte
// values (roughly 4x the original size), so these are base64-encoded
// explicitly instead (roughly 1.33x) and decoded back to a Buffer on
// restore.
// #274's hardening follow-up moved each of these onto its own one-to-one
// table (see schema.prisma) -- the bytes field names stayed the same,
// just keyed by the new table's model name instead of its parent's.
const BYTES_FIELDS = {
  partnerFileBytes: ["bytes"],
  photoBytes: ["bytes"],
  churchSettingsLogo: ["logoBytes"],
  // #271 Finding 8: these three were among the models missing from
  // MODELS entirely, so their Bytes columns were never a concern before
  // either -- same base64 encode/decode treatment as the three above.
  tripParticipantPhoto: ["photo"],
  tripDocumentBytes: ["bytes", "signatureImage"],
  inboundEmailBytes: ["bytes"],
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
