// What a public demo never does: it must not email its fake seeded accounts.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDemoDeployment,
  DEMO_DISABLED_FEATURES,
  demoDisabledFeatureFlags,
} = require("../src/utils/demoMode");
const { FEATURE_KEYS } = require("../src/utils/features");

test("a deployment is a demo exactly when DEMO_RESET_TOKEN is set", () => {
  const original = process.env.DEMO_RESET_TOKEN;
  try {
    delete process.env.DEMO_RESET_TOKEN;
    assert.equal(isDemoDeployment(), false);
    process.env.DEMO_RESET_TOKEN = "x";
    assert.equal(isDemoDeployment(), true);
  } finally {
    if (original === undefined) delete process.env.DEMO_RESET_TOKEN;
    else process.env.DEMO_RESET_TOKEN = original;
  }
});

test("the key-date reminders stay ON for a demo (its email is blocked by the scheduler guard), and every entry is a real feature", () => {
  assert.ok(!DEMO_DISABLED_FEATURES.includes("keyDates"));
  for (const key of DEMO_DISABLED_FEATURES) {
    assert.ok(FEATURE_KEYS.includes(key), `${key} must be a real feature key`);
  }
});

test("the flags spread over a feature object turn exactly those off and nothing else", () => {
  const allOn = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
  const demo = { ...allOn, ...demoDisabledFeatureFlags() };
  for (const key of FEATURE_KEYS) {
    assert.equal(demo[key], !DEMO_DISABLED_FEATURES.includes(key), key);
  }
});
