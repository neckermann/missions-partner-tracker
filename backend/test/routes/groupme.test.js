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
    select: {
      groupmeAccessToken: true,
      groupmeGroupId: true,
      groupmeGroupName: true,
      groupmePrayerTopicId: true,
      groupmePrayerTopicName: true,
      enabledFeatures: true,
    },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      groupmeAccessToken: null,
      groupmeGroupId: null,
      groupmeGroupName: null,
      groupmePrayerTopicId: null,
      groupmePrayerTopicName: null,
    },
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
    assert.equal((await editor("/api/settings/groupme/groups")).status, 403);
  });

  test("admin sees unconfigured, with no token field in the response at all", async () => {
    const res = await admin("/api/settings/groupme");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      configured: false,
      groupId: null,
      groupName: null,
      prayerTopicId: null,
      prayerTopicName: null,
    });
    assert.ok(!("accessToken" in res.body) && !("groupmeAccessToken" in res.body));
  });
});

describe("PUT /api/settings/groupme -- write-only token, partial updates", () => {
  test("saving a token never echoes it back", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { accessToken: "test-token-abc" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    assert.ok(row.groupmeAccessToken.startsWith("v1:"), "token is stored encrypted, not plaintext");
    assert.notEqual(row.groupmeAccessToken, "test-token-abc");
  });

  test("saving a group leaves the token untouched and doesn't require resending it", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });

    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { groupId: "fake-group-id", groupName: `${FIXTURE_TAG} Prayer Requests` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.groupId, "fake-group-id");
    assert.equal(res.body.groupName, `${FIXTURE_TAG} Prayer Requests`);

    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    assert.equal(after.groupmeAccessToken, before.groupmeAccessToken);
  });

  test("saving a prayer topic", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { prayerTopicId: "fake-topic-id", prayerTopicName: "Prayers" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.prayerTopicId, "fake-topic-id");
    assert.equal(res.body.prayerTopicName, "Prayers");
    // Earlier saves (group) survive an update scoped to just the topic.
    assert.equal(res.body.groupId, "fake-group-id");
  });
});

describe("GET /api/settings/groupme/groups and /groups/:id/topics", () => {
  test("400s when no token is saved yet", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { groupmeAccessToken: null },
    });
    assert.equal((await admin("/api/settings/groupme/groups")).status, 400);
    assert.equal((await admin("/api/settings/groupme/groups/abc/topics")).status, 400);

    await admin("/api/settings/groupme", { method: "PUT", body: { accessToken: "test-token-abc" } });
  });

  test("lists groups and topics through the mocked GroupMe API, coercing GroupMe's numeric subgroup ids to strings", async () => {
    // GroupMe's own group ids come back as JSON strings, but a
    // subgroup's (topic's) id comes back as a JSON *number* -- the
    // actual bug this regression-tests: that number has to survive as
    // a string through listTopics(), or picking it in the admin UI 400s
    // on PUT /groupme (which only accepts strings for an id this app
    // otherwise treats as opaque).
    mockGroupMe(async (url) => {
      if (String(url).endsWith("/groups?per_page=100")) {
        return groupmeJson(200, { response: [{ id: "g1", name: "Missions Team" }] });
      }
      if (String(url).endsWith("/groups/g1/subgroups")) {
        return groupmeJson(200, { response: [{ id: 123456789, topic: "Prayers" }] });
      }
      return groupmeJson(404, { meta: { code: 404, errors: ["not found"] } });
    });
    try {
      const groups = await admin("/api/settings/groupme/groups");
      assert.equal(groups.status, 200);
      assert.deepEqual(groups.body, [{ id: "g1", name: "Missions Team" }]);

      const topics = await admin("/api/settings/groupme/groups/g1/topics");
      assert.equal(topics.status, 200);
      assert.deepEqual(topics.body, [{ id: "123456789", name: "Prayers" }]);
      assert.equal(typeof topics.body[0].id, "string", "a numeric GroupMe id must come back as a string");

      // The actual failure path: picking that topic in the admin UI
      // sends its id straight through to PUT /groupme.
      const saved = await admin("/api/settings/groupme", {
        method: "PUT",
        body: { prayerTopicId: topics.body[0].id, prayerTopicName: "Prayers" },
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.prayerTopicId, "123456789");
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

    // Feature on, a topic configured, but GroupMe itself will reject the
    // post below -- this is the actual failure path the hook has to
    // survive, not just an unconfigured no-op. Set explicitly here
    // rather than relying on what an earlier describe block happened to
    // leave behind -- this block should pass on its own regardless of
    // test order.
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true }, groupmePrayerTopicId: "fake-topic-id" },
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

  test("a prayer request posts into the configured topic, not the main group", async () => {
    let capturedUrl = null;
    mockGroupMe(async (url, options) => {
      capturedUrl = String(url);
      JSON.parse(options.body); // confirms it's a well-formed message post
      return groupmeJson(202, { response: null });
    });
    try {
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId,
          category: "strategic",
          requestText: `${FIXTURE_TAG} posts to the topic`,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      assert.ok(capturedUrl?.includes("/groups/fake-topic-id/messages"), capturedUrl);
    } finally {
      unmockGroupMe();
    }
  });
});
