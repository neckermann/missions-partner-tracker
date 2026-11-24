const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
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
      assert.deepEqual(res.body.demoGuestLogins, [], "no guest logins are advertised off the demo either");
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

describe("GET /api/public/settings -- demo guest logins (the demo banner)", () => {
  const keys = ["DEMO_RESET_TOKEN", "DEMO_GUEST_PASSWORD", "DEMO_ADMIN_PASSWORD", "DEMO_ADMIN_EMAIL"];
  const saved = {};
  const restore = () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };

  test("lists the care team member and trip leader, with the demo admin's password", async () => {
    keys.forEach((k) => (saved[k] = process.env[k]));
    process.env.DEMO_RESET_TOKEN = "test-token";
    process.env.DEMO_ADMIN_PASSWORD = "the-demo-password";
    process.env.DEMO_ADMIN_EMAIL = "demo@church.example";
    delete process.env.DEMO_GUEST_PASSWORD;
    try {
      const res = await anon("/api/public/settings");
      assert.deepEqual(
        res.body.demoGuestLogins.map((g) => [g.key, g.email, g.password]),
        [
          ["careTeamMember", "care.member@church.example", "the-demo-password"],
          ["tripLeader", "trip.leader@church.example", "the-demo-password"],
        ]
      );
      assert.equal(res.body.demoLoginPassword, "the-demo-password", "the same one the admin login shows");
      assert.ok(res.body.demoGuestLogins.every((g) => g.label && g.summary));
    } finally {
      restore();
    }
  });

  test("shows the same password the seed uses when DEMO_GUEST_PASSWORD is set", async () => {
    keys.forEach((k) => (saved[k] = process.env[k]));
    process.env.DEMO_RESET_TOKEN = "test-token";
    process.env.DEMO_GUEST_PASSWORD = "custom-guest-pw";
    try {
      const res = await anon("/api/public/settings");
      assert.ok(res.body.demoGuestLogins.every((g) => g.password === "custom-guest-pw"));
    } finally {
      restore();
    }
  });
});

describe("GET /api/public/settings/logo/raw -- embeddable by third parties", () => {
  let originalLogo;

  before(async () => {
    originalLogo = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { logoContentType: true, logoRow: { select: { logoBytes: true } } },
    });
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: {
        logoContentType: "image/png",
        logoRow: {
          upsert: {
            create: { logoBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
            update: { logoBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
          },
        },
      },
      create: {
        id: "singleton",
        logoContentType: "image/png",
        logoRow: { create: { logoBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } },
      },
    });
  });

  after(async () => {
    if (originalLogo) {
      if (originalLogo.logoRow) {
        await prisma.churchSettingsLogo.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", logoBytes: originalLogo.logoRow.logoBytes },
          update: { logoBytes: originalLogo.logoRow.logoBytes },
        });
      } else {
        await prisma.churchSettingsLogo.deleteMany({ where: { id: "singleton" } });
      }
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { logoContentType: originalLogo.logoContentType },
      });
    }
  });

  test("Cross-Origin-Resource-Policy allows cross-origin embedding", async () => {
    // Regression test for #246 -- see photos.test.js's identical check for
    // the full reasoning. The logo rides along in the same digest emails
    // as partner photos, so it needs the same relaxation.
    const res = await anon("/api/public/settings/logo/raw");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
  });
});
