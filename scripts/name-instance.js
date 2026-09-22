#!/usr/bin/env node
// Renames the Render services in render.yaml for one church's instance.
//
// Render Blueprints cannot prompt for a service name: the spec requires
// `name` to be a static string, and Render explicitly does not support
// variable interpolation in Blueprint files. The service name is also what
// determines the deployed URL (<name>.onrender.com). So the only way to
// control either is to edit render.yaml before deploying -- which is what
// this does, as one command rather than four hand-edits that all have to
// agree with each other.
//
// The same applies to `region`, and more sharply: it's optional, it
// silently defaults to oregon, and Render's spec says "You can't modify
// this value after creation." Getting it wrong means destroying and
// recreating every resource to fix it -- which is exactly how this
// project's demo ended up with a Blueprint that could never sync.
//
// Usage:  npm run name-instance -- edgewood-missions-partners ohio

const fs = require("fs");
const path = require("path");

const requested = process.argv[2];
const requestedRegion = process.argv[3];

// From Render's Blueprint spec. Kept here so a typo fails now rather than
// at deploy time, when the resource has already been created somewhere.
const REGIONS = ["oregon", "ohio", "virginia", "frankfurt", "singapore"];

if (!requested) {
  console.error(
    [
      "",
      "Usage: npm run name-instance -- <instance-name>",
      "",
      "Example:",
      "  npm run name-instance -- edgewood-missions-partners",
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

// Render service names allow letters, numbers and hyphens. Check here
// rather than let Render reject the blueprint after a deploy attempt.
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
let text = fs.readFileSync(file, "utf8");

// Match whatever the names currently are rather than assuming the upstream
// defaults, so this stays re-runnable.
const currentService = (text.match(/^ {2}- name: (\S+)\n {4}type: web/m) || [])[1];
const currentDb = (text.match(/^databases:\n {2}- name: (\S+)/m) || [])[1];

if (!currentService || !currentDb) {
  console.error("Couldn't find the service and database names in render.yaml. Has its structure changed?");
  process.exit(1);
}

// Whatever the file currently says, so omitting the argument is a no-op
// rather than a silent reset to Render's oregon default.
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

fs.writeFileSync(file, text);

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
