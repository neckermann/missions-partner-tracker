const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { client, stopServer } = require("./helpers");

// DEMO_RESET_TOKEN is read fresh per request (not cached at startup), so
// these mutate process.env directly around each request rather than
// needing a separate server instance per case.

let anon;

before(async () => {
  anon = await client(null);
});

after(async () => {
  await stopServer();
});

describe("GET /api/public/settings -- demo-mode fields", () => {
  test("isDemo is false and no credentials leak when DEMO_RESET_TOKEN isn't set", async () => {
    const original = process.env.DEMO_RESET_TOKEN;
    delete process.env.DEMO_RESET_TOKEN;
    try {
      const res = await anon("/api/public/settings");
      assert.equal(res.status, 200);
      assert.equal(res.body.isDemo, false);
      assert.equal(res.body.demoLoginEmail, null);
      assert.equal(res.body.demoLoginPassword, null);
    } finally {
      if (original) process.env.DEMO_RESET_TOKEN = original;
    }
  });

  test("isDemo is true and the published demo credentials are exposed when DEMO_RESET_TOKEN is set", async () => {
    const original = {
      DEMO_RESET_TOKEN: process.env.DEMO_RESET_TOKEN,
      DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL,
      DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD,
    };
    process.env.DEMO_RESET_TOKEN = "test-token";
    process.env.DEMO_ADMIN_EMAIL = "demo@example.test";
    process.env.DEMO_ADMIN_PASSWORD = "test-demo-password";
    try {
      const res = await anon("/api/public/settings");
      assert.equal(res.status, 200);
      assert.equal(res.body.isDemo, true);
      assert.equal(res.body.demoLoginEmail, "demo@example.test");
      assert.equal(res.body.demoLoginPassword, "test-demo-password");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
