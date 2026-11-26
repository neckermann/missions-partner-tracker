const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { normalizeWebAddress, webAddress, optionalWebAddress } = require("../src/utils/webAddress");

// Link fields take web addresses only. A script or data link must never be stored.
describe("normalizeWebAddress", () => {
  test("keeps an http or https address as typed", () => {
    assert.equal(normalizeWebAddress("https://example.org/give"), "https://example.org/give");
    assert.equal(normalizeWebAddress("http://example.org"), "http://example.org");
    assert.equal(normalizeWebAddress("  https://example.org  "), "https://example.org");
    assert.equal(normalizeWebAddress("HTTPS://Example.org"), "HTTPS://Example.org");
  });

  test("adds https:// to a bare address, with or without a port", () => {
    assert.equal(normalizeWebAddress("example.org/give"), "https://example.org/give");
    assert.equal(normalizeWebAddress("www.example.org"), "https://www.example.org");
    assert.equal(normalizeWebAddress("example.org:8080/x"), "https://example.org:8080/x");
    assert.equal(normalizeWebAddress("//example.org"), "https://example.org");
  });

  test("refuses every other scheme", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:someone@example.org",
      "tel:+15555550123",
      "file:///etc/passwd",
      "ftp://example.org/x",
      "blob:https://example.org/1",
    ]) {
      assert.equal(normalizeWebAddress(bad), undefined, bad);
    }
  });

  test("refuses blanks, spaces inside and addresses with no host", () => {
    for (const bad of ["", "   ", "https://", "https:///x", "not a url", "https://exa mple.org", "http://"]) {
      assert.equal(normalizeWebAddress(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("zod helpers", () => {
  test("webAddress is required and refuses a script link with a plain message", () => {
    const schema = z.object({ url: webAddress() });
    assert.equal(schema.parse({ url: "example.org" }).url, "https://example.org");
    const bad = schema.safeParse({ url: "javascript:alert(1)" });
    assert.equal(bad.success, false);
    assert.match(bad.error.issues[0].message, /http:\/\/ or https:\/\//);
    assert.equal(schema.safeParse({ url: "" }).success, false);
    assert.equal(schema.safeParse({}).success, false);
  });

  test("optionalWebAddress treats blank/null as no link and leaves a missing field alone", () => {
    const schema = z.object({ link: optionalWebAddress() });
    assert.deepEqual(schema.parse({ link: "" }), { link: null });
    assert.deepEqual(schema.parse({ link: "   " }), { link: null });
    assert.deepEqual(schema.parse({ link: null }), { link: null });
    assert.deepEqual(schema.parse({}), {});
    assert.equal(schema.parse({ link: "example.org" }).link, "https://example.org");
    assert.equal(schema.safeParse({ link: "javascript:alert(1)" }).success, false);
  });
});
