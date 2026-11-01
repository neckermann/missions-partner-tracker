const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// Intercepts only calls to api.joshuaproject.net -- everything else (the
// test harness's own requests to the local server in helpers.js) passes
// through untouched, since both share the same global fetch. Same pattern
// as groupme.test.js's mock.
const realFetch = global.fetch;
let jpResponder = null;
function mockJoshuaProject(responder) {
  jpResponder = responder;
}
function unmockJoshuaProject() {
  jpResponder = null;
}
global.fetch = (url, options) => {
  if (jpResponder && String(url).startsWith("https://api.joshuaproject.net")) {
    return jpResponder(url, options);
  }
  return realFetch(url, options);
};
function jpJson(status, body) {
  return { ok: status >= 200 && status < 300, json: async () => body };
}

let admin;
let editor;
let unauthenticated;
let originalSettings;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { joshuaProjectApiKey: true, enabledFeatures: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { joshuaProjectApiKey: null, enabledFeatures: {} },
    create: { id: "singleton" },
  });
});

after(async () => {
  unmockJoshuaProject();
  global.fetch = realFetch;
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/joshua-project -- admin gate", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/joshua-project")).status, 401);
  });

  test("editor is rejected -- this feature lives behind the admin gate specifically, not just its writes", async () => {
    assert.equal((await editor("/api/settings/joshua-project")).status, 403);
    assert.equal(
      (await editor("/api/settings/joshua-project", { method: "PUT", body: { apiKey: "x" } })).status,
      403
    );
  });

  test("admin sees unconfigured, with no key field in the response at all", async () => {
    const res = await admin("/api/settings/joshua-project");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: false });
    assert.ok(!("apiKey" in res.body) && !("joshuaProjectApiKey" in res.body));
  });
});

describe("PUT /api/settings/joshua-project -- write-only key", () => {
  test("saving a key never echoes it back, and is stored encrypted", async () => {
    const res = await admin("/api/settings/joshua-project", {
      method: "PUT",
      body: { apiKey: "test-jp-key-abc" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true });

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { joshuaProjectApiKey: true },
    });
    assert.ok(row.joshuaProjectApiKey.startsWith("v1:"), "key is stored encrypted, not plaintext");
    assert.notEqual(row.joshuaProjectApiKey, "test-jp-key-abc");
  });

  test("saving nothing leaves the stored key untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { joshuaProjectApiKey: true },
    });
    const res = await admin("/api/settings/joshua-project", { method: "PUT", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);
    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { joshuaProjectApiKey: true },
    });
    assert.equal(after.joshuaProjectApiKey, before.joshuaProjectApiKey);
  });
});

describe("GET /api/public/country-info/:countryCode -- feature gate", () => {
  test("404s when the feature is off, even with a key configured", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    const res = await unauthenticated("/api/public/country-info/US");
    assert.equal(res.status, 404);
  });

  test("reachable once the feature is on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { joshuaProject: true } },
    });
    mockJoshuaProject(async () => jpJson(200, [{ Ctry: "United States", Population: 331000000 }]));
    try {
      const res = await unauthenticated("/api/public/country-info/US");
      assert.equal(res.status, 200);
      assert.equal(res.body.Ctry, "United States");
    } finally {
      unmockJoshuaProject();
    }
  });

  test("404s with a clean message when the API has nothing for that code, even with the feature on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { joshuaProject: true } },
    });
    mockJoshuaProject(async () => jpJson(200, []));
    try {
      const res = await unauthenticated("/api/public/country-info/ZZ");
      assert.equal(res.status, 404);
      assert.equal(res.body.error, "No country info available");
    } finally {
      unmockJoshuaProject();
    }
  });
});
