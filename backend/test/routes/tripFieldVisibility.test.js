// Guards a recurring gap: a column gets added to TripParticipant/TripApplication and nothing
// ever shows it. This reads every scalar column Prisma's schema metadata reports for both
// models and fails if a column's name isn't referenced anywhere in
// AdminTripParticipantDetail.jsx, the canonical complete-record view. A plain string match,
// not a rendering assertion: it makes the absence loud.
//
// A column genuinely meant to have no UI home opts out with an explicit `//
// tripFieldVisibility: intentionally admin-invisible` trailing comment on its declaration line
// in schema.prisma. No live database needed: Prisma.dmmf is static schema metadata.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Prisma } = require("@prisma/client");

const SCHEMA_PATH = path.join(__dirname, "../../prisma/schema.prisma");
const PARTICIPANT_PAGE_PATH = path.join(
  __dirname,
  "../../../frontend/src/pages/AdminTripParticipantDetail.jsx"
);
const OPT_OUT_MARKER = "tripFieldVisibility: intentionally admin-invisible";

function fieldsNeedingVisibility(modelName, schemaLines) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  return model.fields.filter((f) => {
    if (f.kind !== "scalar") return false; // relations have no column of their own to "show"
    if (f.name === "id" || /Id$/.test(f.name)) return false; // the id itself, plus FKs -- tripId, applicationId, reviewedById
    // Timestamps only, by this codebase's naming convention (schema.prisma: "*At" = DateTime with
    // a time component, "*Date" = date-only), NOT every DateTime-typed field. DMMF reports the
    // same "DateTime" type for @db.Timestamp and @db.Date, so filtering on f.type would also
    // exempt a meaningful date field like dateOfBirth.
    if (/At$/.test(f.name)) return false; // createdAt, reviewedAt
    const declarationLine = schemaLines.find((line) => new RegExp(`^\\s*${f.name}\\s`).test(line));
    if (declarationLine && declarationLine.includes(OPT_OUT_MARKER)) return false;
    return true;
  });
}

describe("Trips field visibility -- every TripParticipant/TripApplication column has a UI home", () => {
  const schemaLines = fs.readFileSync(SCHEMA_PATH, "utf8").split("\n");
  const pageSource = fs.readFileSync(PARTICIPANT_PAGE_PATH, "utf8");

  for (const modelName of ["TripParticipant", "TripApplication"]) {
    for (const field of fieldsNeedingVisibility(modelName, schemaLines)) {
      test(`${modelName}.${field.name} is referenced in AdminTripParticipantDetail.jsx`, () => {
        assert.ok(
          pageSource.includes(field.name),
          `${modelName}.${field.name} has no UI home on the canonical participant page, and no ` +
            `"${OPT_OUT_MARKER}" marker on its line in schema.prisma. Either wire it up or mark it ` +
            `intentionally invisible.`
        );
      });
    }
  }
});
