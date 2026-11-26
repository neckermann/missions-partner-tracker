// The email-off rule (CONTRIBUTING.md § Email paths need an email-off option): every file that sends email is
// listed in utils/emailSenders.js with what happens when Email (Sending) is off.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EMAIL_SENDERS, WHEN_OFF } = require("../src/utils/emailSenders");

const SRC = path.join(__dirname, "..", "src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
}

// A file sends email when it requires the shared sender (utils/email.js), directly.
const REQUIRES_SENDER = /require\((["'])(?:\.\/|\.\.\/utils\/)email\1\)/;

test("every file that sends email declares what happens when email is off", () => {
  const senders = walk(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .filter((rel) => rel !== "utils/email.js")
    .filter((rel) => REQUIRES_SENDER.test(fs.readFileSync(path.join(SRC, rel), "utf8")));
  const missing = senders.filter((rel) => !EMAIL_SENDERS[rel]);
  assert.deepEqual(
    missing,
    [],
    `These files send email but have no email-off option in utils/emailSenders.js: ${missing.join(", ")}`
  );
});

test("every declared sender exists, uses a known option, and says what it does", () => {
  for (const [rel, entry] of Object.entries(EMAIL_SENDERS)) {
    assert.ok(fs.existsSync(path.join(SRC, rel)), `${rel} is listed but no longer exists`);
    assert.ok(WHEN_OFF.includes(entry.whenOff), `${rel}: whenOff must be one of ${WHEN_OFF.join(", ")}`);
    assert.ok(
      typeof entry.note === "string" && entry.note.trim().length > 20,
      `${rel}: say what the person gets`
    );
  }
});
