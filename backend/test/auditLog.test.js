// The pure parts of the audit trail: the action catalogue, the retention choices, and the
// secret-never-recorded helper. The database side (writing, the feature gate, deletion-proof
// history, pruning) is covered in test/routes/auditLog.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  AUDIT_ACTIONS,
  RETENTION_CHOICES,
  DEFAULT_RETENTION_DAYS,
  retentionDays,
  secretChange,
} = require("../src/utils/auditLog");

test("every action has a label and a category, and a dotted code", () => {
  for (const [code, meta] of Object.entries(AUDIT_ACTIONS)) {
    assert.match(code, /^[a-z_]+\.[a-z_]+$/, code);
    assert.ok(meta.label && meta.category, code);
  }
});

test("retention is 30, 60 or 90 days, and anything else falls back to 90", () => {
  assert.deepEqual(RETENTION_CHOICES, [30, 60, 90]);
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  for (const ok of RETENTION_CHOICES) assert.equal(retentionDays(ok), ok);
  for (const bad of [0, 7, 365, -1, null, undefined, "90", NaN]) {
    assert.equal(retentionDays(bad), 90, String(bad));
  }
});

test("a secret change records that it changed, never its value", () => {
  assert.deepEqual(secretChange(["anthropicApiKey", "postmarkServerToken"]), {
    anthropicApiKey: "changed",
    postmarkServerToken: "changed",
  });
  assert.deepEqual(secretChange([]), {});
});

test("the audit log is on unless it is switched off", () => {
  const { isFeatureEnabled, FEATURES } = require("../src/utils/features");
  assert.equal(FEATURES.auditTrail.label, "Audit log");
  assert.equal(
    isFeatureEnabled(undefined, "auditTrail"),
    true,
    "no settings stored yet: recording from the first sign-in"
  );
  assert.equal(isFeatureEnabled({}, "auditTrail"), true, "an existing install that never set it");
  assert.equal(isFeatureEnabled({ auditTrail: false }, "auditTrail"), false);
  assert.equal(isFeatureEnabled({ auditTrail: true }, "auditTrail"), true);
});
