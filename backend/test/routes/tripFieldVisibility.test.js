// Enforces the recurring gap §19/§20 of the Trips plan doc named as its
// top UX finding: a column gets added to TripParticipant/TripApplication
// and nothing ever shows it, discovered only by accident, repeatedly.
// A one-time manual audit fixes today's gaps; it does nothing about the
// next one. This test reads every scalar column Prisma's own schema
// metadata reports for both models and fails if a column's name isn't
// referenced anywhere in AdminTripParticipantDetail.jsx's source -- the
// one page this plan designates as that model's canonical complete-
// record view. A plain string match, not a rendering assertion: this
// exists to make the absence loud, not to verify correctness of what's
// already there.
//
// A column genuinely meant to have no UI home (internal bookkeeping,
// always-the-same-value-in-this-context, etc.) opts out with an explicit
// `// tripFieldVisibility: intentionally admin-invisible` trailing
// comment on its own declaration line in schema.prisma -- a deliberate,
// visible decision, not a silent gap this test can't tell apart from a
// real one.
//
// No live database needed -- Prisma.dmmf is static schema metadata from
// the generated client package, not a connection.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Prisma } = require("@prisma/client");

const SCHEMA_PATH = path.join(__dirname, "../../prisma/schema.prisma");
const PARTICIPANT_PAGE_PATH = path.join(__dirname, "../../../frontend/src/pages/AdminTripParticipantDetail.jsx");
const OPT_OUT_MARKER = "tripFieldVisibility: intentionally admin-invisible";

function fieldsNeedingVisibility(modelName, schemaLines) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  return model.fields.filter((f) => {
    if (f.kind !== "scalar") return false; // relations have no column of their own to "show"
    if (f.name === "id" || /Id$/.test(f.name)) return false; // the id itself, plus FKs -- tripId, applicationId, reviewedById
    if (f.type === "DateTime") return false; // timestamps -- submittedAt, reviewedAt
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
