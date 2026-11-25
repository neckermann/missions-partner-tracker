#!/usr/bin/env node
// Renames the Render services in render.yaml for one church's instance.
//
// Render Blueprints can't prompt for a service name: `name` must be a static string, with no
// variable interpolation, and it determines the deployed URL (<name>.onrender.com). So the name
// is set by editing render.yaml, here as one command rather than four hand-edits that must
// agree.
//
// The same applies to `region`: it is optional, silently defaults to oregon, and "can't be
// modified after creation", so a wrong value means recreating every resource.
//
// Usage:  npm run name-instance -- your-church-name oregon

const fs = require("fs");
const path = require("path");

const requested = process.argv[2];
const requestedRegion = process.argv[3];

// From Render's Blueprint spec. Kept here so a typo fails now rather than at deploy time.
const REGIONS = ["oregon", "ohio", "virginia", "frankfurt", "singapore"];

if (!requested) {
  console.error(
    [
      "",
      "Usage: npm run name-instance -- <instance-name>",
      "",
      "Example:",
      "  npm run name-instance -- your-church-name oregon",
      "",
      "Renames the web service and database in render.yaml. The web service",
      "name becomes the app's URL, so pick something that identifies your",
      "church: edgewood-missions-partners gives",
      "edgewood-missions-partners.onrender.com",
      "",
      "Optional second argument sets the region:",
      "  " + REGIONS.join(", "),
      "",
      "Region cannot be changed after the resources are created -- moving",
      "later means destroying and recreating them. Omit it to keep whatever",
      "render.yaml already specifies.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

// Render service names allow letters, numbers and hyphens. Checked here rather than rejected
// after a deploy attempt.
if (!/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/.test(requested)) {
  console.error(
    '"' +
      requested +
      '" is not a usable Render service name.\n' +
      "Use lowercase letters, numbers and hyphens, starting and ending with a letter or number."
  );
  process.exit(1);
}

if (requestedRegion && !REGIONS.includes(requestedRegion)) {
  console.error('"' + requestedRegion + '" is not a Render region. Choose one of: ' + REGIONS.join(", "));
  process.exit(1);
}

// Postgres database names cannot contain hyphens.
const dbName = requested.replace(/-/g, "_");

const file = path.join(__dirname, "..", "render.yaml");
const raw = fs.readFileSync(file, "utf8");

// Normalise line endings before matching: on Windows git checks out CRLF, every pattern below
// anchors on a bare newline, and every match would silently fail. Git re-applies the platform's
// convention on commit, so writing LF back is correct.
const usedCrlf = raw.includes("\r\n");
const text0 = usedCrlf ? raw.replace(/\r\n/g, "\n") : raw;
let text = text0;

// Match whatever the names currently are, not the upstream defaults, so this stays re-runnable.
const currentService = (text.match(/^ {2}- name: (\S+)\n {4}type: web/m) || [])[1];
const currentDb = (text.match(/^databases:\n {2}- name: (\S+)/m) || [])[1];

if (!currentService || !currentDb) {
  console.error("Couldn't find the service and database names in render.yaml. Has its structure changed?");
  process.exit(1);
}

// Whatever the file currently says, so omitting the argument is a no-op rather than a reset to
// Render's oregon default.
const currentRegion = (text.match(/^ {4}region: (\S+)$/m) || [])[1] || "oregon (implied default)";
const region = requestedRegion || currentRegion;

const before = text;
if (requestedRegion) {
  text = text.replace(/^ {4}region: \S+$/gm, "    region: " + requestedRegion);
}
text = text
  .replace("  - name: " + currentDb + "\n", "  - name: " + requested + "-db\n")
  .replace(/^ {4}databaseName: \S+$/m, "    databaseName: " + dbName)
  .replace("  - name: " + currentService + "\n    type: web", "  - name: " + requested + "\n    type: web")
  .replace("          name: " + currentDb, "          name: " + requested + "-db");

if (text === before) {
  console.log('render.yaml already uses "' + requested + '". Nothing to do.');
  process.exit(0);
}

fs.writeFileSync(file, usedCrlf ? text.replace(/\n/g, "\r\n") : text);

console.log(
  [
    "",
    "render.yaml updated:",
    "",
    "  web service : " + currentService + "  ->  " + requested,
    "  database    : " + currentDb + "  ->  " + requested + "-db",
    "  db name     : " + dbName,
    "  region      : " + region + (requestedRegion ? "" : "   (unchanged)"),
    "",
    "Region is permanent. Render's spec: \"You can't modify this value after",
    'creation." Changing it later means destroying and recreating both the',
    "service and the database. Check it now, not after the first deploy.",
    "",
    "Your app will deploy to https://" + requested + ".onrender.com",
    "(Render appends a suffix if that name is already taken in your account.)",
    "",
    "Next:",
    '  1. git commit -am "Name the Render services for this instance"',
    "  2. git push",
    "  3. Render Dashboard -> New -> Blueprint -> select YOUR repo",
    "     Not the Deploy button in the upstream README: its URL points at",
    "     the upstream project, so it deploys that instead of yours.",
    "",
  ].join("\n")
);
