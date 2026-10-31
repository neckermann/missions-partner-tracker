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
    select: { groupmeAccessToken: true, groupmeGroupId: true, groupmeGroupName: true, enabledFeatures: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { groupmeAccessToken: null, groupmeGroupId: null, groupmeGroupName: null },
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

  test("admin sees unconfigured, with no token field in the response at all", async () => {
    const res = await admin("/api/settings/groupme");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: false, groupName: null, groupId: null });
    assert.ok(!("accessToken" in res.body) && !("groupmeAccessToken" in res.body));
  });
});

describe("PUT /api/settings/groupme -- write-only token", () => {
  test("saving a token and name never echoes the token back", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { accessToken: "test-token-abc", groupName: `${FIXTURE_TAG} Prayer Requests` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      configured: true,
      groupName: `${FIXTURE_TAG} Prayer Requests`,
      groupId: null,
    });

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    assert.ok(row.groupmeAccessToken.startsWith("v1:"), "token is stored encrypted, not plaintext");
    assert.notEqual(row.groupmeAccessToken, "test-token-abc");
  });

  test("a blank accessToken on a later save leaves the stored token untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
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
      select: { groupmeAccessToken: true },
    });
    assert.equal(after.groupmeAccessToken, before.groupmeAccessToken);
  });
});

describe("POST /api/settings/groupme/create-group", () => {
  test("400s when nothing is configured yet", async () => {
    const original = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true, groupmeGroupName: true },
    });
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { groupmeAccessToken: null, groupmeGroupName: null },
    });

    const res = await admin("/api/settings/groupme/create-group", { method: "POST" });
    assert.equal(res.status, 400);

    await prisma.churchSettings.update({ where: { id: "singleton" }, data: original });
  });

  test("creates the group through the mocked GroupMe API and stores the returned id", async () => {
    mockGroupMe(async () =>
      groupmeJson(200, { response: { id: "fake-group-id", share_url: "https://groupme.com/join_group/x/y" } })
    );
    try {
      const res = await admin("/api/settings/groupme/create-group", { method: "POST" });
      assert.equal(res.status, 200);
      assert.equal(res.body.groupId, "fake-group-id");
      assert.equal(res.body.shareUrl, "https://groupme.com/join_group/x/y");

      const row = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { groupmeGroupId: true },
      });
      assert.equal(row.groupmeGroupId, "fake-group-id");
    } finally {
      unmockGroupMe();
    }
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

    // Feature on, a group configured, but GroupMe itself will reject the
    // post below -- this is the actual failure path the hook has to
    // survive, not just an unconfigured no-op.
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true }, groupmeGroupId: "fake-group-id" },
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
});
