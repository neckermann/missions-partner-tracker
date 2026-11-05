const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isFeatureEnabled } = require("../src/utils/features");

describe("isFeatureEnabled", () => {
  test("defaults to enabled for a key with no stored value (partnerFiles)", () => {
    assert.equal(isFeatureEnabled({}, "partnerFiles"), true);
    assert.equal(isFeatureEnabled(null, "partnerFiles"), true);
  });

  test("an explicit false overrides the default-enabled state", () => {
    assert.equal(isFeatureEnabled({ partnerFiles: false }, "partnerFiles"), false);
  });

  test("an explicit true keeps a default-enabled feature on", () => {
    assert.equal(isFeatureEnabled({ partnerFiles: true }, "partnerFiles"), true);
  });

  test("returns false for a key not in the registry", () => {
    assert.equal(isFeatureEnabled({ notReal: true }, "notReal"), false);
  });

  describe("aiExtraction (defaults to off, same as any other opt-in feature)", () => {
    // Used to also require ANTHROPIC_API_KEY to be set as an env var --
    // the key is admin-managed in ChurchSettings now (see
    // test/routes/aiExtraction.test.js for that), so this is a plain
    // toggle like groupme/joshuaProject, with no second gate here.
    test("stays off with no stored value", () => {
      assert.equal(isFeatureEnabled({}, "aiExtraction"), false);
    });

    test("an explicit true turns it on", () => {
      assert.equal(isFeatureEnabled({ aiExtraction: true }, "aiExtraction"), true);
    });
  });
});
