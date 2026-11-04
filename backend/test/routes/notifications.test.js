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
  TEST_USERS,
} = require("./helpers");

// Same mock-the-whole-domain technique email.test.js/groupme.test.js each
// use on their own -- combined here since a flush can call both channels
// in one request.
const realFetch = global.fetch;
let groupmeResponder = null;
let postmarkResponder = null;
function mockGroupMe(responder) {
  groupmeResponder = responder;
}
function mockPostmark(responder) {
  postmarkResponder = responder;
}
function unmockAll() {
  groupmeResponder = null;
  postmarkResponder = null;
}
global.fetch = (url, options) => {
  const s = String(url);
  if (groupmeResponder && s.startsWith("https://api.groupme.com")) return groupmeResponder(url, options);
  if (postmarkResponder && s.startsWith("https://api.postmarkapp.com"))
    return postmarkResponder(url, options);
  return realFetch(url, options);
};
function groupmeJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function postmarkJson(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let admin;
let editor;
let viewer;
let unauthenticated;
let originalSettings;
let partnerId;

async function createPrayerRequest(requestText) {
  const res = await admin("/api/prayer-requests", {
    method: "POST",
    body: { partnerId, category: "situational", requestText, dateReceived: "2026-01-01" },
  });
  assert.equal(res.status, 201, `fixture setup failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      groupmeAccessToken: true,
      groupmeGroupId: true,
      groupmePrayerTopicId: true,
      postmarkServerToken: true,
      emailFromAddress: true,
      digestFrequency: true,
      digestDayOfWeek: true,
      digestDayOfMonth: true,
      digestHour: true,
      lastDigestSentAt: true,
      queueNotifyPrayerRequests: true,
      queueNotifyOneTimeNeeds: true,
      queueNotifyNewsletters: true,
    },
  });
  // Clean slate -- same reasoning as groupme.test.js/email.test.js's own
  // before(): guarantees the singleton row exists (a cold DB has none
  // yet) and that nothing from an earlier test file lingers.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: {},
      groupmeAccessToken: null,
      groupmeGroupId: null,
      groupmePrayerTopicId: null,
      postmarkServerToken: null,
      emailFromAddress: null,
      digestFrequency: null,
      digestDayOfWeek: null,
      digestDayOfMonth: null,
      digestHour: null,
      lastDigestSentAt: null,
      queueNotifyPrayerRequests: true,
      queueNotifyOneTimeNeeds: true,
      queueNotifyNewsletters: true,
    },
    create: { id: "singleton" },
  });

  await removeFixturePartners();
  const partner = await (
    await client("admin")
  )("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} notifications flush target` },
  });
  partnerId = partner.body.id;
});

after(async () => {
  unmockAll();
  global.fetch = realFetch;
  await prisma.pendingNotification.deleteMany({ where: { partnerId } });
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/notifications -- admin gate and defaults", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/notifications")).status, 401);
  });

  test("editor is rejected", async () => {
    assert.equal((await editor("/api/settings/notifications")).status, 403);
  });

  test("admin sees the defaults on an unconfigured instance", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        digestFrequency: null,
        digestDayOfWeek: null,
        digestDayOfMonth: null,
        digestHour: null,
        queueNotifyPrayerRequests: true,
        queueNotifyOneTimeNeeds: true,
        queueNotifyNewsletters: true,
      },
    });
    const res = await admin("/api/settings/notifications");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      digestFrequency: null,
      digestDayOfWeek: null,
      digestDayOfMonth: null,
      digestHour: null,
      queueNotifyPrayerRequests: true,
      queueNotifyOneTimeNeeds: true,
      queueNotifyNewsletters: true,
    });
  });

  test("a partial PUT only touches the fields it sends", async () => {
    const first = await admin("/api/settings/notifications", {
      method: "PUT",
      body: { digestFrequency: "weekly", digestDayOfWeek: 1, digestHour: 9 },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.digestFrequency, "weekly");

    const second = await admin("/api/settings/notifications", {
      method: "PUT",
      body: { queueNotifyNewsletters: false },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.queueNotifyNewsletters, false);
    assert.equal(second.body.digestFrequency, "weekly", "the earlier schedule save must survive");
  });

  test("an invalid frequency is rejected", async () => {
    const res = await admin("/api/settings/notifications", {
      method: "PUT",
      body: { digestFrequency: "daily" },
    });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/notifications/send -- role gate", () => {
  test("unauthenticated and viewer are rejected", async () => {
    assert.equal((await unauthenticated("/api/notifications/send", { method: "POST" })).status, 401);
    assert.equal((await viewer("/api/notifications/send", { method: "POST" })).status, 403);
  });
});

describe("POST /api/notifications/send -- flush behavior", () => {
  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        queueNotifyPrayerRequests: true,
        queueNotifyOneTimeNeeds: true,
        queueNotifyNewsletters: true,
      },
    });
  });

  test("nothing enabled -- flush is a no-op, nothing gets cleared", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    await createPrayerRequest(`${FIXTURE_TAG} nothing enabled`);

    const res = await admin("/api/notifications/send", { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 0);

    const stillQueued = await prisma.pendingNotification.findFirst({
      where: { partnerId, type: "prayerRequestCreated" },
    });
    assert.ok(stillQueued, "the row should remain queued when no channel is enabled");
  });

  test("GroupMe enabled, working token -- packs and posts to the configured topic, clears the row", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: true },
        groupmeAccessToken: null,
      },
    });
    const put = await admin("/api/settings/groupme", {
      method: "PUT",
      body: { accessToken: "fake-token", prayerTopicId: "fake-prayer-topic" },
    });
    assert.equal(put.status, 200);

    const requestText = `${FIXTURE_TAG} groupme batch send`;
    await createPrayerRequest(requestText);

    let capturedUrl = null;
    let capturedText = null;
    mockGroupMe(async (url, options) => {
      capturedUrl = String(url);
      capturedText = JSON.parse(options.body).message.text;
      return groupmeJson(202, { response: null });
    });
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);
      assert.ok(res.body.sent >= 1);
      assert.ok(capturedUrl?.includes("/groups/fake-prayer-topic/messages"), capturedUrl);
      assert.ok(capturedText?.includes(requestText), capturedText);

      const remaining = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      assert.ok(
        !remaining.some((row) => row.payload.requestText === requestText),
        "a successfully-sent row should be cleared"
      );
    } finally {
      unmockAll();
    }
  });

  test("GroupMe fails -- the row stays queued, not silently dropped", async () => {
    const requestText = `${FIXTURE_TAG} groupme fails, stays queued`;
    await createPrayerRequest(requestText);

    mockGroupMe(async () => groupmeJson(500, { meta: { code: 500, errors: ["boom"] } }));
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);

      const remaining = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      assert.ok(
        remaining.some((row) => row.payload.requestText === requestText && !row.groupmeSentAt),
        "a failed GroupMe send must leave the row queued for retry"
      );
    } finally {
      unmockAll();
    }
  });

  test("Email enabled and a user opted in -- sends the digest, clears the row", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: false, outboundEmail: true } },
    });
    const put = await admin("/api/settings/email", {
      method: "PUT",
      body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.org" },
    });
    assert.equal(put.status, 200);
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });

    const requestText = `${FIXTURE_TAG} email digest send`;
    await createPrayerRequest(requestText);

    let sentTo = null;
    mockPostmark(async (url, options) => {
      sentTo = JSON.parse(options.body).To;
      return postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" });
    });
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);
      assert.equal(sentTo, TEST_USERS.admin.email);

      const remaining = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      assert.ok(
        !remaining.some((row) => row.payload.requestText === requestText),
        "a successfully-emailed row should be cleared"
      );
    } finally {
      unmockAll();
      await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: false } });
    }
  });

  test("both channels on, GroupMe fails and Email succeeds -- row stays queued but only retries GroupMe next time", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true, outboundEmail: true } },
    });
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });

    const requestText = `${FIXTURE_TAG} partial success, both channels`;
    await createPrayerRequest(requestText);

    mockGroupMe(async () => groupmeJson(500, { meta: { code: 500, errors: ["boom"] } }));
    mockPostmark(async () =>
      postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" })
    );
    try {
      const first = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(first.status, 200);

      const rows = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      const row = rows.find((r) => r.payload.requestText === requestText);
      assert.ok(row, "the row must still be queued -- GroupMe failed");
      assert.ok(row.emailSentAt, "email succeeded and should be marked sent");
      assert.equal(row.groupmeSentAt, null, "GroupMe failed and should not be marked sent");

      // Second flush: GroupMe now succeeds, email mock untouched (would
      // throw if called again unexpectedly -- it's still mocked to
      // succeed, but the real assertion is that the row finally clears).
      mockGroupMe(async () => groupmeJson(202, { response: null }));
      const second = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(second.status, 200);

      const finalRows = await prisma.pendingNotification.findMany({
        where: { partnerId, type: "prayerRequestCreated" },
      });
      assert.ok(
        !finalRows.some((r) => r.payload.requestText === requestText),
        "once GroupMe also succeeds, the row should finally clear"
      );
    } finally {
      unmockAll();
      await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: false } });
    }
  });
});

describe("GET /api/notifications/pending -- any logged-in role", () => {
  test("a viewer can list the queue", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    const requestText = `${FIXTURE_TAG} viewer can see this`;
    await createPrayerRequest(requestText);

    const res = await viewer("/api/notifications/pending");
    assert.equal(res.status, 200);
    assert.ok(res.body.some((item) => item.bodyText === requestText));
    assert.ok(
      res.body.every((item) => "emoji" in item && "summary" in item),
      "pending items should already be blurb-shaped for display"
    );
  });
});

describe("unsubscribe", () => {
  test("GET /api/auth/unsubscribe with a valid token turns notifyByEmail off", async () => {
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });
    const me = await admin("/api/auth/me");
    assert.equal(me.body.user.notifyByEmail, true);

    const jwt = require("jsonwebtoken");
    const token = jwt.sign({ id: me.body.user.id, unsubscribe: true }, process.env.SESSION_SECRET);
    const res = await unauthenticated(`/api/auth/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);

    const after = await admin("/api/auth/me");
    assert.equal(after.body.user.notifyByEmail, false);
  });

  test("an invalid token is rejected", async () => {
    assert.equal((await unauthenticated("/api/auth/unsubscribe?token=garbage")).status, 400);
  });

  test("a missing token is rejected", async () => {
    assert.equal((await unauthenticated("/api/auth/unsubscribe")).status, 400);
  });
});
