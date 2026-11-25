const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
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
  "careTeamMember", // -> partner, user
  "contactLog", // -> partner, user
  "keyDateReminder", // -> partner, user
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
// (~1.33x) and decoded on restore. Each lives on its own one-to-one table, keyed by that model name.
const BYTES_FIELDS = {
  partnerFileBytes: ["bytes"],
  photoBytes: ["bytes"],
  churchSettingsLogo: ["logoBytes"],
  // Same base64 treatment as the three above.
  tripParticipantPhoto: ["photo"],
  tripDocumentBytes: ["bytes", "signatureImage"],
  inboundEmailBytes: ["bytes"],
};

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

// Builds the full backup as a gzipped buffer: one manifest line (app version,
// migration name, timestamp, per-model row counts, sha256 of every following
// line), then one JSON line per row tagged with its model. Uses the restore order.
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

module.exports = { MODELS, buildBackup, parseBackup, restoreRows, latestMigrationName };
