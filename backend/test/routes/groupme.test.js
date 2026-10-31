const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

// Intercepts only calls to api.groupme.com -- everything else (the test
// harness's own requests to the local server in helpers.js) passes
// through untouched, since both share the same global fetch.
const realFetch = global.fetch;
let groupmeResponder = null;
function mockGroupMe(responder) {
  groupmeResponder = responder;
}
function unmockGroupMe() {
  groupmeResponder = null;
}
global.fetch = (url, options) => {
  if (groupmeResponder && String(url).startsWith("https://api.groupme.com")) {
    return groupmeResponder(url, options);
  }
  return realFetch(url, options);
};
function groupmeJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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
    select: { groupmeBotId: true, groupmeGroupName: true, enabledFeatures: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { groupmeBotId: null, groupmeGroupName: null },
    create: { id: "singleton" },
  });

  await removeFixturePartners();
});

after(async () => {
  unmockGroupMe();
  global.fetch = realFetch;
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/groupme -- admin gate", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/groupme")).status, 401);
  });

  test("editor is rejected -- this feature lives behind the admin gate specifically, not just its writes", async () => {
    assert.equal((await editor("/api/settings/groupme")).status, 403);
    assert.equal(
      (await editor("/api/settings/groupme", { method: "PUT", body: { groupName: "x" } })).status,
      403
    );
  });

  test("admin sees unconfigured, with no bot id field in the response at all", async () => {
    const res = await admin("/api/settings/groupme");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: false, groupName: null });
    assert.ok(!("botId" in res.body) && !("groupmeBotId" in res.body));
  });
});

describe("PUT /api/settings/groupme -- write-only bot id", () => {
  test("saving a bot id and name never echoes the bot id back", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { botId: "test-bot-id-abc", groupName: `${FIXTURE_TAG} Prayer Requests` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true, groupName: `${FIXTURE_TAG} Prayer Requests` });

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeBotId: true },
    });
    assert.ok(row.groupmeBotId.startsWith("v1:"), "bot id is stored encrypted, not plaintext");
    assert.notEqual(row.groupmeBotId, "test-bot-id-abc");
  });

  test("a blank botId on a later save leaves the stored bot id untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeBotId: true },
    });

    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { groupName: `${FIXTURE_TAG} Renamed` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.groupName, `${FIXTURE_TAG} Renamed`);
    assert.equal(res.body.configured, true);

    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeBotId: true },
    });
    assert.equal(after.groupmeBotId, before.groupmeBotId);
  });
});

describe("prayer request creation never fails because of GroupMe", () => {
  let partnerId;

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} GroupMe notify target` },
    });
    partnerId = partner.body.id;

    // Feature on, a bot configured, but GroupMe itself will reject the
    // post below -- this is the actual failure path the hook has to
    // survive, not just an unconfigured no-op.
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true } },
    });
  });

  after(async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
  });

  test("a prayer request still saves (201) when the GroupMe post itself fails", async () => {
    mockGroupMe(async () => groupmeJson(500, { meta: { code: 500, errors: ["boom"] } }));
    try {
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId,
          category: "situational",
          requestText: `${FIXTURE_TAG} should still save`,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.requestText, `${FIXTURE_TAG} should still save`);
    } finally {
      unmockGroupMe();
    }
  });

  test("a prayer request posts successfully through the mocked bot API", async () => {
    let capturedBody = null;
    mockGroupMe(async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return groupmeJson(202, { response: null });
    });
    try {
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId,
          category: "strategic",
          requestText: `${FIXTURE_TAG} posts via the bot`,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      assert.ok(capturedBody, "the bot endpoint was actually called");
      assert.equal(capturedBody.bot_id, "test-bot-id-abc");
      assert.match(capturedBody.text, /posts via the bot/);
    } finally {
      unmockGroupMe();
    }
  });
});
