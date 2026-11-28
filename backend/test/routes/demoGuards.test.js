// A1 of the November 2026 app review, at the HTTP boundary. On a guarded public demo (DEMO_RESET_TOKEN
// set, DEMO_TESTING_SITE not) a visitor signed in as the published admin cannot change the shared
// password or the integration settings, and the owner's own test deployment (DEMO_TESTING_SITE=true)
// publishes no logins. The environment is read per request, so these set it around each call.
const { test, describe, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_USERS } = require("./helpers");

const KEYS = ["DEMO_RESET_TOKEN", "DEMO_TESTING_SITE", "DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD"];
let saved;
let admin;
let anon;

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function guardedDemo() {
  process.env.DEMO_RESET_TOKEN = "test-token";
  delete process.env.DEMO_TESTING_SITE;
}

describe("a guarded demo refuses what would lock out or cost the owner", () => {
  test("changing your own password", async () => {
    guardedDemo();
    const res = await admin("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: "whatever", newPassword: "A-Brand-New-Passw0rd!" },
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /public demo/);
  });

  test("an admin setting another account's password", async () => {
    guardedDemo();
    const editor = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.editor.email } });
    const res = await admin(`/api/users/${editor.id}`, {
      method: "PUT",
      body: { password: "A-Brand-New-Passw0rd!" },
    });
    assert.equal(res.status, 403);
  });

  test("changing the GroupMe connection and the AI key", async () => {
    guardedDemo();
    const groupme = await admin("/api/settings/groupme", { method: "PUT", body: { accessToken: "x" } });
    assert.equal(groupme.status, 403);
    const ai = await admin("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: "sk-test" } });
    assert.equal(ai.status, 403);
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.ok(!row?.anthropicApiKey, "no AI key may have been stored");
  });
});

describe("the email settings", () => {
  test("a guarded demo can still read them but not change them", async () => {
    guardedDemo();
    const before = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const features = { ...(before?.enabledFeatures || {}), outboundEmail: true };
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { enabledFeatures: features },
      create: { id: "singleton", enabledFeatures: features },
    });
    try {
      const read = await admin("/api/settings/email");
      assert.equal(read.status, 200, JSON.stringify(read.body));
      const write = await admin("/api/settings/email", { method: "PUT", body: { serverToken: "x" } });
      assert.equal(write.status, 403);
    } finally {
      await prisma.churchSettings.updateMany({
        where: { id: "singleton" },
        data: { enabledFeatures: before?.enabledFeatures ?? undefined },
      });
    }
  });
});

describe("setting a password through a setup link", () => {
  test("is refused on a guarded demo (it would change a published login)", async () => {
    guardedDemo();
    const editor = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.editor.email } });
    assert.equal((await admin(`/api/users/${editor.id}/setup-link`, { method: "POST" })).status, 403);
    const complete = await anon("/api/auth/password-setup/complete", {
      method: "POST",
      body: { token: "x", password: "A-Brand-New-Passw0rd!" },
    });
    assert.equal(complete.status, 403);
  });
});

describe("outside a guarded demo the same requests are not refused for being a demo", () => {
  test("on the owner's test deployment, an integration setting saves", async () => {
    guardedDemo();
    process.env.DEMO_TESTING_SITE = "true";
    const res = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { model: "claude-test-model" },
    });
    assert.notEqual(res.status, 403);
    await prisma.churchSettings.updateMany({ where: { id: "singleton" }, data: { extractionModel: null } });
  });
});

describe("the published logins", () => {
  test("a guarded demo publishes them; the owner's test deployment does not", async () => {
    guardedDemo();
    process.env.DEMO_ADMIN_EMAIL = "demo@example.test";
    process.env.DEMO_ADMIN_PASSWORD = "test-demo-password";
    const published = await anon("/api/public/settings");
    assert.equal(published.body.isDemo, true);
    assert.equal(published.body.demoLoginEmail, "demo@example.test");
    assert.equal(published.body.demoLoginPassword, "test-demo-password");
    assert.ok(published.body.demoGuestLogins.length > 0);

    process.env.DEMO_TESTING_SITE = "true";
    const hidden = await anon("/api/public/settings");
    assert.equal(hidden.body.isDemo, true, "it is still a demo, so the banner still explains that");
    assert.equal(hidden.body.demoLoginEmail, null);
    assert.equal(hidden.body.demoLoginPassword, null);
    assert.deepEqual(hidden.body.demoGuestLogins, []);
  });
});
