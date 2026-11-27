const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// DEMO_RESET_TOKEN is read fresh per request (not cached at startup), so
// these mutate process.env directly around each request rather than
// needing a separate server instance per case.

let anon;

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
});

after(async () => {
  await removeTestUsers();
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
    // Regression test (see photos.test.js's identical check): the logo rides along in the same
    // digest emails as partner photos, so it needs the same Cross-Origin-Resource-Policy
    // relaxation.
    const res = await anon("/api/public/settings/logo/raw");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
  });
});

describe("GET /api/public/settings -- the Subscribe page passage (#508)", () => {
  let original;
  before(async () => {
    original = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { subscribePassage: true, subscribePassageSource: true },
    });
  });
  after(async () => {
    await prisma.churchSettings.updateMany({ where: { id: "singleton" }, data: original || {} });
  });

  test("is empty until a church sets one", async () => {
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { subscribePassage: null, subscribePassageSource: null },
      create: { id: "singleton" },
    });
    const res = await anon("/api/public/settings");
    assert.equal(res.body.subscribePassage, null);
    assert.equal(res.body.subscribePassageSource, null);
  });

  test("is served once an admin sets it, and a blank value clears it", async () => {
    const admin = await client("admin");
    const set = await admin("/api/settings", {
      method: "PUT",
      body: { subscribePassage: "  Pray without ceasing.  ", subscribePassageSource: "1 Thessalonians 5:17" },
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    let res = await anon("/api/public/settings");
    assert.equal(res.body.subscribePassage, "Pray without ceasing.");
    assert.equal(res.body.subscribePassageSource, "1 Thessalonians 5:17");

    await admin("/api/settings", {
      method: "PUT",
      body: { subscribePassage: "", subscribePassageSource: "" },
    });
    res = await anon("/api/public/settings");
    assert.equal(res.body.subscribePassage, null);
    assert.equal(res.body.subscribePassageSource, null);
  });

  test("an over-long passage is refused", async () => {
    const admin = await client("admin");
    const res = await admin("/api/settings", { method: "PUT", body: { subscribePassage: "x".repeat(4001) } });
    assert.equal(res.status, 400);
  });
});

describe("the church-wide currency", () => {
  let original;
  before(async () => {
    original = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { currency: true },
    });
  });
  after(async () => {
    await prisma.churchSettings.updateMany({
      where: { id: "singleton" },
      data: { currency: original?.currency || "USD" },
    });
  });

  test("is USD until a church changes it, and is public so every page can show amounts", async () => {
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { currency: "USD" },
      create: { id: "singleton" },
    });
    assert.equal((await anon("/api/public/settings")).body.currency, "USD");
  });

  test("an admin can change it, in any letter case, and the public setting follows", async () => {
    const admin = await client("admin");
    const res = await admin("/api/settings", { method: "PUT", body: { currency: " eur " } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.currency, "EUR");
    assert.equal((await anon("/api/public/settings")).body.currency, "EUR");
  });

  test("a code that is not a currency is refused and changes nothing", async () => {
    const admin = await client("admin");
    for (const bad of ["ZZZ", "dollars", "$", "US", ""]) {
      const res = await admin("/api/settings", { method: "PUT", body: { currency: bad } });
      assert.equal(res.status, 400, bad);
    }
    assert.equal((await anon("/api/public/settings")).body.currency, "EUR");
  });

  test("only an admin can change it", async () => {
    const editor = await client("editor");
    const res = await editor("/api/settings", { method: "PUT", body: { currency: "CAD" } });
    assert.equal(res.status, 403);
  });
});
