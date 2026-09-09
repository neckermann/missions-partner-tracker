const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { isFeatureEnabled } = require("../src/utils/features");

describe("isFeatureEnabled", () => {
  test("defaults to enabled for a key with no stored value (newsletters)", () => {
    assert.equal(isFeatureEnabled({}, "newsletters"), true);
    assert.equal(isFeatureEnabled(null, "newsletters"), true);
  });

  test("an explicit false overrides the default-enabled state", () => {
    assert.equal(isFeatureEnabled({ newsletters: false }, "newsletters"), false);
  });

  test("an explicit true keeps a default-enabled feature on", () => {
    assert.equal(isFeatureEnabled({ newsletters: true }, "newsletters"), true);
  });

  test("returns false for a key not in the registry", () => {
    assert.equal(isFeatureEnabled({ notReal: true }, "notReal"), false);
  });

  describe("aiExtraction (defaults to off, requires ANTHROPIC_API_KEY)", () => {
    let originalKey;
    beforeEach(() => {
      originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    });
    afterEach(() => {
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    });

    test("stays off with no stored value, even with the env var set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      assert.equal(isFeatureEnabled({}, "aiExtraction"), false);
    });

    test("stays off when toggled on but the env var is missing", () => {
      assert.equal(isFeatureEnabled({ aiExtraction: true }, "aiExtraction"), false);
    });

    test("turns on only when both toggled on and the env var is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      assert.equal(isFeatureEnabled({ aiExtraction: true }, "aiExtraction"), true);
    });
  });
});
