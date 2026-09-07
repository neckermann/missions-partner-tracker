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
});
