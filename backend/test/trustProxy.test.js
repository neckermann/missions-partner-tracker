// How many proxies are trusted for the visitor's address (B9): one by default, settable, never "true".
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { readTrustProxy, trustProxySetting, describeTrustProxy } = require("../src/utils/trustProxy");

describe("TRUST_PROXY", () => {
  test("defaults to one proxy hop", () => {
    assert.deepEqual(readTrustProxy({}), { hops: 1, explicit: false });
    assert.deepEqual(readTrustProxy({ TRUST_PROXY: "" }), { hops: 1, explicit: false });
  });

  test("0 means nothing in front, 2 means two proxies", () => {
    assert.deepEqual(readTrustProxy({ TRUST_PROXY: "0" }), { hops: 0, explicit: true });
    assert.deepEqual(readTrustProxy({ TRUST_PROXY: "2" }), { hops: 2, explicit: true });
  });

  test("anything else, including true, falls back to one hop and is reported", () => {
    for (const bad of ["true", "-1", "1.5", "11", "abc"]) {
      const r = readTrustProxy({ TRUST_PROXY: bad });
      assert.equal(r.hops, 1, bad);
      assert.equal(r.invalid, bad);
    }
  });

  test("Express gets false for none, otherwise the number (never true)", () => {
    assert.equal(trustProxySetting({ hops: 0 }), false);
    assert.equal(trustProxySetting({ hops: 1 }), 1);
    assert.equal(trustProxySetting({ hops: 2 }), 2);
  });

  test("the start-up line says what is assumed and what to set", () => {
    const line = describeTrustProxy({ hops: 1, explicit: false });
    assert.match(line, /1 proxy hop in front/);
    assert.match(line, /\(the default\)/);
    assert.match(line, /TRUST_PROXY/);
    assert.match(describeTrustProxy({ hops: 0, explicit: true }), /reached directly/);
    assert.match(
      describeTrustProxy({ hops: 1, explicit: false, invalid: "true" }),
      /not a number from 0 to 10/
    );
  });
});
