const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { appBaseUrl } = require("../src/utils/urls");

describe("appBaseUrl", () => {
  let originalAppBaseUrl, originalRenderUrl;
  beforeEach(() => {
    originalAppBaseUrl = process.env.APP_BASE_URL;
    originalRenderUrl = process.env.RENDER_EXTERNAL_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
  });
  afterEach(() => {
    if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalAppBaseUrl;
    if (originalRenderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = originalRenderUrl;
  });

  test("prefers an explicitly-set APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "https://missions.example.org";
    process.env.RENDER_EXTERNAL_URL = "https://some-app.onrender.com";
    assert.equal(appBaseUrl(), "https://missions.example.org");
  });

  test("falls back to Render's own RENDER_EXTERNAL_URL when APP_BASE_URL is unset", () => {
    process.env.RENDER_EXTERNAL_URL = "https://some-app.onrender.com";
    assert.equal(appBaseUrl(), "https://some-app.onrender.com");
  });

  test("returns undefined when neither is set (e.g. not running on Render, no custom domain configured)", () => {
    assert.equal(appBaseUrl(), undefined);
  });
});
