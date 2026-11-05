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
      groupmeOneTimeNeedTopicId: true,
      groupmeOneTimeNeedTopicName: true,
      groupmeNewsletterTopicId: true,
      groupmeNewsletterTopicName: true,
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
      groupmeOneTimeNeedTopicId: null,
      groupmeOneTimeNeedTopicName: null,
      groupmeNewsletterTopicId: null,
      groupmeNewsletterTopicName: null,
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
      oneTimeNeedTopicId: null,
      oneTimeNeedTopicName: null,
      newsletterTopicId: null,
      newsletterTopicName: null,
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

  test("saving a one-time-need topic leaves the prayer topic untouched", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { oneTimeNeedTopicId: "fake-need-topic-id", oneTimeNeedTopicName: "Needs" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.oneTimeNeedTopicId, "fake-need-topic-id");
    assert.equal(res.body.oneTimeNeedTopicName, "Needs");
    assert.equal(res.body.prayerTopicId, "fake-topic-id", "the earlier prayer topic save must survive");
  });

  test("saving a newsletter topic leaves the other two topics untouched", async () => {
    const res = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { newsletterTopicId: "fake-newsletter-topic-id", newsletterTopicName: "Newsletters" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.newsletterTopicId, "fake-newsletter-topic-id");
    assert.equal(res.body.newsletterTopicName, "Newsletters");
    assert.equal(res.body.prayerTopicId, "fake-topic-id");
    assert.equal(res.body.oneTimeNeedTopicId, "fake-need-topic-id");
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

// As of #129, record creation/outcome events no longer post to GroupMe
// live -- they write a PendingNotification row instead (see
// utils/notifications.js), flushed later by routes/notifications.js.
// The actual GroupMe posting (topic routing, packing, truncation) is
// tested against that flush route in test/routes/notifications.test.js,
// which is also where it belongs now -- this file stays focused on
// GroupMe's own settings routes. What's left to verify here is just the
// dispatcher's own enqueue behavior: a row gets written with the right
// type/partner/payload, and the per-type queueNotify* switch is actually
// respected.
describe("prayer request creation enqueues a PendingNotification instead of posting live", () => {
  let partnerId;

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} enqueue target` },
    });
    partnerId = partner.body.id;
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  });

  test("creating a prayer request never calls GroupMe directly and writes a queued row instead", async () => {
    let called = false;
    mockGroupMe(async () => {
      called = true;
      return groupmeJson(202, { response: null });
    });
    try {
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId,
          category: "situational",
          requestText: `${FIXTURE_TAG} enqueues, doesn't post live`,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      assert.equal(called, false, "no live GroupMe call should happen at creation time");

      const queued = await prisma.pendingNotification.findMany({ where: { partnerId } });
      assert.equal(queued.length, 1);
      assert.equal(queued[0].type, "prayerRequestCreated");
      assert.equal(queued[0].payload.requestText, `${FIXTURE_TAG} enqueues, doesn't post live`);
    } finally {
      unmockGroupMe();
    }
  });

  test("queueNotifyPrayerRequests: false skips the queue entirely", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { queueNotifyPrayerRequests: false },
    });
    try {
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId,
          category: "situational",
          requestText: `${FIXTURE_TAG} should never queue`,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      const queued = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      assert.ok(
        !queued.some((row) => row.payload.requestText === `${FIXTURE_TAG} should never queue`),
        "turning the queue type off should prevent a row from ever being written"
      );
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { queueNotifyPrayerRequests: true },
      });
    }
  });
});

describe("support need creation enqueues a PendingNotification instead of posting live", () => {
  let partnerId;

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} enqueue need target` },
    });
    partnerId = partner.body.id;
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  });

  test("creating a one-time need never calls GroupMe directly and writes a queued row instead", async () => {
    let called = false;
    mockGroupMe(async () => {
      called = true;
      return groupmeJson(202, { response: null });
    });
    try {
      const res = await admin("/api/support-needs", {
        method: "POST",
        body: {
          partnerId,
          description: `${FIXTURE_TAG} enqueues, doesn't post live`,
          requestedAmount: 500,
          requestDate: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);
      assert.equal(called, false);

      const queued = await prisma.pendingNotification.findMany({ where: { partnerId } });
      assert.equal(queued.length, 1);
      assert.equal(queued[0].type, "supportNeedCreated");
      assert.equal(queued[0].payload.description, `${FIXTURE_TAG} enqueues, doesn't post live`);
    } finally {
      unmockGroupMe();
    }
  });
});

// #127: notifications on answering a prayer request / deciding a
// one-time need. Routed through utils/notifications.js's channel-neutral
// dispatch -- same enqueue-not-post-live behavior as creation above, and
// still only on a genuine transition (not a repeat PUT).
describe("recording a prayer request's answer enqueues, same transition-only rule as before", () => {
  let partnerId;

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} enqueue answered target` },
    });
    partnerId = partner.body.id;
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  });

  async function createOngoing(requestText) {
    const res = await admin("/api/prayer-requests", {
      method: "POST",
      body: { partnerId, category: "situational", requestText, dateReceived: "2026-01-01" },
    });
    assert.equal(res.status, 201);
    return res.body.id;
  }

  // Scoped to this one record's own requestText, not just partnerId+type
  // -- several tests in this block share one partner, so a bare
  // partnerId+type count would also see earlier tests' own rows.
  async function queuedAnsweredCountFor(requestText) {
    const rows = await prisma.pendingNotification.findMany({
      where: { partnerId, type: "prayerRequestAnswered" },
    });
    return rows.filter((row) => row.payload.requestText === requestText).length;
  }

  test("transitioning status to answered queues a prayerRequestAnswered row with the note", async () => {
    const requestText = `${FIXTURE_TAG} please pray for travel safety`;
    const id = await createOngoing(requestText);
    const res = await admin(`/api/prayer-requests/${id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-02-01", answeredNote: "Arrived home safely." },
    });
    assert.equal(res.status, 200);
    assert.equal(await queuedAnsweredCountFor(requestText), 1);
  });

  test("a PUT that doesn't touch status never queues anything", async () => {
    const requestText = `${FIXTURE_TAG} unrelated field edit`;
    const id = await createOngoing(requestText);
    const res = await admin(`/api/prayer-requests/${id}`, {
      method: "PUT",
      body: { notes: "internal note" },
    });
    assert.equal(res.status, 200);
    assert.equal(await queuedAnsweredCountFor(requestText), 0);
  });

  test("re-saving an already-answered request (e.g. fixing a typo) doesn't re-queue", async () => {
    const requestText = `${FIXTURE_TAG} already answered, editing note`;
    const id = await createOngoing(requestText);
    const first = await admin(`/api/prayer-requests/${id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-02-01", answeredNote: "Original note." },
    });
    assert.equal(first.status, 200);

    const second = await admin(`/api/prayer-requests/${id}`, {
      method: "PUT",
      // dateAnswered has to be resent -- answeredDateGiven requires it
      // alongside status: "answered" in the same request (see the
      // schema's own refine), same as a real edit form would.
      body: { status: "answered", dateAnswered: "2026-02-01", answeredNote: "Fixed a typo in the note." },
    });
    assert.equal(second.status, 200);

    assert.equal(
      await queuedAnsweredCountFor(requestText),
      1,
      "only the genuine transition should have queued a row"
    );
  });
});

describe("recording a one-time need's decision enqueues, same transition-only rule as before", () => {
  let partnerId;

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} enqueue decided target` },
    });
    partnerId = partner.body.id;
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  });

  async function createUndecided(description, requestedAmount) {
    const res = await admin("/api/support-needs", {
      method: "POST",
      body: { partnerId, description, requestedAmount, requestDate: "2026-01-01" },
    });
    assert.equal(res.status, 201);
    return res.body.id;
  }

  // Scoped to this one record's own description, not just partnerId+type
  // -- several tests in this block share one partner.
  async function queuedDecidedCountFor(description) {
    const rows = await prisma.pendingNotification.findMany({
      where: { partnerId, type: "supportNeedDecided" },
    });
    return rows.filter((row) => row.payload.description === description).length;
  }

  test("recording a decision queues a supportNeedDecided row with the approved amount", async () => {
    const description = `${FIXTURE_TAG} vehicle replacement`;
    const id = await createUndecided(description, 1000);
    const res = await admin(`/api/support-needs/${id}`, {
      method: "PUT",
      body: { approvedAmount: 1000, approvedDate: "2026-02-01" },
    });
    assert.equal(res.status, 200);
    assert.equal(await queuedDecidedCountFor(description), 1);
  });

  test("a PUT that doesn't touch the decision pair never queues anything", async () => {
    const description = `${FIXTURE_TAG} unrelated edit`;
    const id = await createUndecided(description, 500);
    const res = await admin(`/api/support-needs/${id}`, { method: "PUT", body: { notes: "internal note" } });
    assert.equal(res.status, 200);
    assert.equal(await queuedDecidedCountFor(description), 0);
  });

  test("clearing a decision (both fields nulled) doesn't queue anything", async () => {
    const description = `${FIXTURE_TAG} clearing a decision`;
    const id = await createUndecided(description, 500);
    const first = await admin(`/api/support-needs/${id}`, {
      method: "PUT",
      body: { approvedAmount: 500, approvedDate: "2026-02-01" },
    });
    assert.equal(first.status, 200);

    const second = await admin(`/api/support-needs/${id}`, {
      method: "PUT",
      body: { approvedAmount: null, approvedDate: null },
    });
    assert.equal(second.status, 200);

    assert.equal(
      await queuedDecidedCountFor(description),
      1,
      "only the original decision should have queued a row"
    );
  });
});

describe("newsletter creation enqueues a PendingNotification instead of posting live", () => {
  let partnerId;

  function uploadForm(fields) {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "t.pdf");
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return form;
  }

  before(async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} enqueue newsletter target` },
    });
    partnerId = partner.body.id;
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  });

  test("uploading a newsletter never calls GroupMe directly and writes a queued row instead", async () => {
    let called = false;
    mockGroupMe(async () => {
      called = true;
      return groupmeJson(202, { response: null });
    });
    try {
      const created = await admin("/api/partner-files", {
        method: "POST",
        body: uploadForm({ partnerId, kind: "newsletter", receivedDate: "2026-01-01" }),
      });
      assert.equal(created.status, 201);
      assert.equal(called, false);

      const queued = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "newsletterCreated" },
      });
      assert.equal(queued.length, 1);
      assert.equal(queued[0].payload.newsletterId, created.body.id);
    } finally {
      unmockGroupMe();
    }
  });
});
