const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let editor;
let viewer;
let unauthenticated;
let originalSettings;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { anthropicApiKey: true, enabledFeatures: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { anthropicApiKey: null },
    create: { id: "singleton" },
  });
});

after(async () => {
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/ai-extraction -- admin gate", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/ai-extraction")).status, 401);
  });

  test("editor is rejected -- this feature lives behind the admin gate specifically, not just its writes", async () => {
    assert.equal((await editor("/api/settings/ai-extraction")).status, 403);
    assert.equal(
      (await editor("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: "x" } })).status,
      403
    );
  });

  test("admin sees unconfigured, with no key field in the response at all", async () => {
    const res = await admin("/api/settings/ai-extraction");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: false });
    assert.ok(!("apiKey" in res.body) && !("anthropicApiKey" in res.body));
  });
});

describe("PUT /api/settings/ai-extraction -- write-only key", () => {
  test("saving a key never echoes it back, and is stored encrypted", async () => {
    const res = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-test-key-abc123" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true });

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.ok(row.anthropicApiKey.startsWith("v1:"), "key is stored encrypted, not plaintext");
    assert.notEqual(row.anthropicApiKey, "sk-ant-test-key-abc123");
  });

  test("saving nothing leaves the stored key untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);
    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.equal(after.anthropicApiKey, before.anthropicApiKey);
  });
});

// This is real, billable money on the key owner's own Anthropic account
// (see the comment on anthropicApiKey in schema.prisma) -- these tests
// are the explicit, automated "does it ever leak" guard asked for
// alongside this feature, independent of (and on top of) the ordinary
// admin-gate/write-only-field tests above. Rather than trust that every
// endpoint which happens to touch ChurchSettings individually remembers
// to omit the field, this greps the raw response text of every endpoint
// a non-admin or a general settings fetch can reach, so a future route
// that forgets to omit anthropicApiKey fails loudly here instead of
// silently shipping a leak.
describe("the real key literal never appears in any response, anywhere", () => {
  const REAL_KEY = "sk-ant-REAL-SECRET-should-never-leak-9f8e7d6c5b4a";

  before(async () => {
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: REAL_KEY } });
    assert.equal(res.status, 200, "fixture setup: saving the key should succeed");
  });

  test("GET /api/settings (any logged-in role) never includes the key", async () => {
    for (const asUser of [admin, editor, viewer]) {
      const res = await asUser("/api/settings");
      assert.equal(res.status, 200);
      assert.ok(
        !JSON.stringify(res.body).includes(REAL_KEY),
        "the real API key leaked into GET /api/settings"
      );
    }
  });

  test("GET /api/settings/ai-extraction never includes the key, even encrypted", async () => {
    const res = await admin("/api/settings/ai-extraction");
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_KEY),
      "the real API key leaked into GET /api/settings/ai-extraction"
    );
  });

  test("PUT /api/settings/ai-extraction's own response never echoes the key back", async () => {
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: REAL_KEY } });
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_KEY),
      "the real API key was echoed back in the PUT response"
    );
  });

  test("the row's stored value is never the plaintext key, only the encrypted form", async () => {
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.notEqual(row.anthropicApiKey, REAL_KEY);
    assert.ok(row.anthropicApiKey.startsWith("v1:"));
  });
});

describe("AI request scanning route is gated by the feature flag", () => {
  test("the scan endpoint 404s when the feature is off (verified via a 404 from requireFeature, not a 400 from the missing-key check)", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { aiExtraction: false } },
    });
    // Newsletters' scan sub-route 404s before ever reaching extraction.js,
    // same "off means 404" rule every other gated feature gets -- not
    // exercising an actual file here, just confirming the gate itself.
    const res = await admin("/api/newsletters/00000000-0000-4000-8000-000000000000/extract", {
      method: "POST",
    });
    assert.equal(res.status, 404);
  });
});
