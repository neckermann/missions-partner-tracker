const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// The app's own vocabulary ("dispatch", "cadence", "tier", a developer ticket number...) must not come back
// into text a person reads. This scans the app's source for the exact phrases that were replaced with plain
// words (see CHANGELOG, #500). Comments and variable names are not user-facing and are skipped; only the
// phrases below are checked, so renaming a variable never trips it.
const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = [
  "Pending Dispatches",
  "Dispatch Settings",
  "Email Dispatch",
  "Dispatches needing approval",
  "Dispatch send failures",
  "Dispatch health",
  "GroupMe dispatch",
  "WhatsApp dispatch",
  "Digest cadence",
  "Unmatched Email",
  "Postgres provider",
  "(#209)",
  "(FIPS",
  "Strategic (",
  "Situational (",
  '"Strategic"',
  '"Situational"',
  ">Strategic<",
  ">Situational<",
  "Which tiers",
  "these tiers",
  "all three tiers",
];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "public" || entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

test("no user-facing text uses the app's old vocabulary", () => {
  const found = [];
  for (const dir of ["frontend/src", "backend/src"]) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          for (const phrase of FORBIDDEN) {
            if (line.includes(phrase)) found.push(`${path.relative(ROOT, file)}:${i + 1}: ${phrase}`);
          }
        });
    }
  }
  assert.deepEqual(found, [], `Old wording is still in user-facing text:\n${found.join("\n")}`);
});
