const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { configuredOrigin, wrongAddressMessage } = require("../src/utils/passkeys");

// A passkey only works at the one address the site is set to. When the browser is at another, the person is told
// which address to use instead of a bare "couldn't be verified".
const req = (origin) => ({ get: (name) => (name.toLowerCase() === "origin" ? origin : undefined) });
let saved;
beforeEach(() => {
  saved = { base: process.env.APP_BASE_URL, render: process.env.RENDER_EXTERNAL_URL };
});
afterEach(() => {
  for (const [key, value] of [
    ["APP_BASE_URL", saved.base],
    ["RENDER_EXTERNAL_URL", saved.render],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("wrongAddressMessage", () => {
  test("names both addresses when the browser is at a different one", () => {
    process.env.APP_BASE_URL = "https://church.example.org/";
    const message = wrongAddressMessage(req("https://church.onrender.com"));
    assert.match(message, /Passkeys only work at https:\/\/church\.example\.org/);
    assert.match(message, /you are at https:\/\/church\.onrender\.com/);
    assert.match(message, /APP_BASE_URL/);
  });

  test("is null at the right address, with no Origin header, and when no address is configured", () => {
    process.env.APP_BASE_URL = "https://church.example.org";
    assert.equal(wrongAddressMessage(req("https://church.example.org")), null);
    assert.equal(wrongAddressMessage(req(undefined)), null);
    delete process.env.APP_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(wrongAddressMessage(req("https://anything.example.org")), null);
  });

  test("falls back to Render's own address, and an unreadable setting counts as none", () => {
    delete process.env.APP_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = "https://church.onrender.com";
    assert.equal(configuredOrigin(), "https://church.onrender.com");
    process.env.APP_BASE_URL = "not a url";
    assert.equal(configuredOrigin(), null);
  });
});
