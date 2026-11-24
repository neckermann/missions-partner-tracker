const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isNewer } = require("../src/utils/versionCheck");

describe("isNewer", () => {
  test("returns false for an identical version", () => {
    assert.equal(isNewer("1.0.14", "1.0.14"), false);
  });

  test("detects a newer patch version", () => {
    assert.equal(isNewer("1.0.15", "1.0.14"), true);
    assert.equal(isNewer("1.0.14", "1.0.15"), false);
  });

  test("detects a newer minor version, even with a lower patch", () => {
    assert.equal(isNewer("1.1.0", "1.0.99"), true);
  });

  test("detects a newer major version, even with lower minor/patch", () => {
    assert.equal(isNewer("2.0.0", "1.99.99"), true);
  });

  test("tolerates a leading 'v' on the latest tag", () => {
    assert.equal(isNewer("v1.0.15", "1.0.14"), true);
  });

  test("treats a missing/malformed segment as 0", () => {
    assert.equal(isNewer("1.1", "1.0.5"), true);
  });

  test("a pre-release is older than its own final release", () => {
    assert.equal(isNewer("0.1.0", "0.1.0-beta.3"), true);
    assert.equal(isNewer("0.1.0-beta.3", "0.1.0"), false);
  });

  test("betas order by number, numerically (beta.10 is after beta.2)", () => {
    assert.equal(isNewer("0.1.0-beta.2", "0.1.0-beta.1"), true);
    assert.equal(isNewer("0.1.0-beta.10", "0.1.0-beta.2"), true);
    assert.equal(isNewer("0.1.0-beta.2", "0.1.0-beta.10"), false);
    assert.equal(isNewer("0.1.0-beta.2", "0.1.0-beta.2"), false);
  });

  test("a later release's beta is newer than the earlier final release", () => {
    assert.equal(isNewer("0.2.0-beta.1", "0.1.0"), true);
    assert.equal(isNewer("0.1.1", "0.1.0-beta.9"), true);
    assert.equal(isNewer("0.1.0-beta.9", "0.2.0-beta.1"), false);
  });

  test("identifier rules: numeric below alphanumeric, shorter set below longer", () => {
    assert.equal(isNewer("1.0.0-alpha", "1.0.0-1"), true);
    assert.equal(isNewer("1.0.0-beta", "1.0.0-alpha"), true);
    assert.equal(isNewer("1.0.0-alpha.1", "1.0.0-alpha"), true);
  });

  test("ignores build metadata and a leading v on a pre-release tag", () => {
    assert.equal(isNewer("v0.1.0-beta.2", "0.1.0-beta.1+abc"), true);
    assert.equal(isNewer("0.1.0+build5", "0.1.0"), false);
  });
});
