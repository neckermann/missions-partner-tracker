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
      queueNotifyRestrictedPartners: true,
      digestSubjectTemplate: true,
      digestSignature: true,
      digestTemplate: true,
      churchName: true,
      address: true,
      phone: true,
      websiteLink: true,
      partnerTermSingular: true,
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
      queueNotifyRestrictedPartners: true,
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
        queueNotifyRestrictedPartners: true,
        digestSubjectTemplate: null,
        digestSignature: null,
        digestTemplate: null,
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
      queueNotifyRestrictedPartners: true,
      digestSubjectTemplate: null,
      digestSignature: null,
      digestTemplate: null,
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

  test("digest customization -- custom subject template, signature, and church contact info all appear in the send", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: false, outboundEmail: true },
        churchName: "Hillside Community Church",
        digestFrequency: "weekly",
        digestSubjectTemplate: "{frequency} update for {church} ({month} {year}) -- hi {name}",
        digestSignature: "Grace and peace,\nThe Hillside Missions Team",
        address: {
          addressLine1: "123 Main St",
          city: "Springfield",
          stateProvinceRegion: "IL",
          postalCode: "62701",
        },
        phone: "555-123-4567",
        websiteLink: "https://hillside.example.org",
      },
    });
    const put = await admin("/api/settings/email", {
      method: "PUT",
      body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.org" },
    });
    assert.equal(put.status, 200);
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });

    const requestText = `${FIXTURE_TAG} digest customization`;
    await createPrayerRequest(requestText);

    let capturedSubject = null;
    let capturedHtml = null;
    mockPostmark(async (url, options) => {
      const body = JSON.parse(options.body);
      capturedSubject = body.Subject;
      capturedHtml = body.HtmlBody;
      return postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" });
    });
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);

      assert.ok(
        capturedSubject.startsWith("Weekly update for Hillside Community Church"),
        `{frequency} and {church} should substitute: ${capturedSubject}`
      );
      // TEST_USERS.admin has no name set, so {name} should fall back to
      // "there" -- same fallback the greeting itself uses.
      assert.ok(
        capturedSubject.endsWith("hi there"),
        `{name} should fall back to "there": ${capturedSubject}`
      );
      // {month}/{year} aren't asserted against an exact value (no
      // time-mocking in this codebase -- see digestScheduler.test.js's
      // own comment on the same constraint) -- just confirm they were
      // substituted at all, not left as literal unreplaced tokens.
      assert.doesNotMatch(
        capturedSubject,
        /\{month\}|\{year\}/,
        `tokens should be substituted: ${capturedSubject}`
      );

      assert.ok(capturedHtml.includes("Grace and peace,"), "signature should appear in the HTML body");
      assert.ok(capturedHtml.includes("123 Main St"), "address should appear in the HTML body");
      assert.ok(capturedHtml.includes("555-123-4567"), "phone should appear in the HTML body");
      assert.ok(capturedHtml.includes("hillside.example.org"), "website link should appear in the HTML body");
    } finally {
      unmockAll();
      await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: false } });
    }
  });

  test("no subject template set -- falls back to {date} {church} - {term} Updates", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: false, outboundEmail: true },
        churchName: "Hillside Community Church",
        digestSubjectTemplate: null,
        partnerTermSingular: "Go Team Partner",
      },
    });
    const put = await admin("/api/settings/email", {
      method: "PUT",
      body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.org" },
    });
    assert.equal(put.status, 200);
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });

    const requestText = `${FIXTURE_TAG} default subject`;
    await createPrayerRequest(requestText);

    let capturedSubject = null;
    mockPostmark(async (url, options) => {
      capturedSubject = JSON.parse(options.body).Subject;
      return postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" });
    });
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);

      assert.ok(
        capturedSubject.endsWith("Hillside Community Church - Go Team Partner Updates"),
        `{church} and {term} should substitute into the default: ${capturedSubject}`
      );
      // No time-mocking in this codebase -- just confirm {date} was
      // substituted at all, not left as a literal unreplaced token.
      assert.doesNotMatch(capturedSubject, /\{date\}/, `{date} should be substituted: ${capturedSubject}`);
    } finally {
      unmockAll();
      await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: false } });
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { partnerTermSingular: null } });
    }
  });

  test("digestTemplate -- snapshot adds the partner tile (photo/field/overview), classic doesn't", async () => {
    await prisma.partner.update({
      where: { id: partnerId },
      data: { fieldDisplayName: "Northern Thailand", overviewShort: "Serving church planters in the north." },
    });
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: false, outboundEmail: true }, digestTemplate: "classic" },
    });
    const put = await admin("/api/settings/email", {
      method: "PUT",
      body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.org" },
    });
    assert.equal(put.status, 200);
    await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: true } });

    let capturedHtml = null;
    mockPostmark(async (url, options) => {
      capturedHtml = JSON.parse(options.body).HtmlBody;
      return postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" });
    });
    try {
      await createPrayerRequest(`${FIXTURE_TAG} classic layout check`);
      let res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);
      assert.ok(!capturedHtml.includes("Northern Thailand"), "classic should not show the field");
      assert.ok(!capturedHtml.includes("Serving church planters"), "classic should not show the overview");

      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { digestTemplate: "snapshot" },
      });
      await createPrayerRequest(`${FIXTURE_TAG} snapshot layout check`);
      res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);
      assert.ok(capturedHtml.includes("Northern Thailand"), "snapshot should show the field");
      assert.ok(capturedHtml.includes("Serving church planters"), "snapshot should show the overview");
      assert.ok(capturedHtml.includes("border-radius:50%"), "snapshot should render a circular photo/avatar");
    } finally {
      unmockAll();
      await admin("/api/auth/notify-by-email", { method: "PUT", body: { enabled: false } });
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { digestTemplate: null } });
      await prisma.partner.update({
        where: { id: partnerId },
        data: { fieldDisplayName: null, overviewShort: null },
      });
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

  test("a restricted partner's notification masks name/photo/source link but shows the real text to any role", async () => {
    const restrictedPartner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Jordan Rivera`, isRestricted: true },
    });
    assert.equal(restrictedPartner.status, 201, JSON.stringify(restrictedPartner.body));
    const restrictedId = restrictedPartner.body.id;

    const requestText = `${FIXTURE_TAG} restricted partner's real prayer request text`;
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: { partnerId: restrictedId, category: "situational", requestText, dateReceived: "2026-01-01" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    try {
      // Structural masking (name, photo, source link) applies regardless
      // of role -- that's the real security boundary (public vs. admin
      // dashboard). The request/need text itself is not role-gated here,
      // same as GET /api/prayer-requests/GET /api/support-needs already
      // show it to any logged-in role with no masking at all -- so a
      // held row's real text shows up the same way for every role.
      for (const asRole of [admin, editor, viewer]) {
        const res = await asRole("/api/notifications/pending");
        assert.equal(res.status, 200);
        const item = res.body.find((i) => i.partnerId === restrictedId);
        assert.ok(item, "the restricted partner's notification should still be queued and visible");
        assert.equal(item.isRestricted, true);
        assert.ok(
          !item.partnerName.includes("Jordan") && !item.partnerName.includes("Rivera"),
          `real name must not leak: ${item.partnerName}`
        );
        assert.equal(item.bodyText, requestText, "the real text should show, not the generic placeholder");
        assert.equal(item.sourceLinkUrl, null, "no source link for a restricted partner's notification");
        // #187: an unreviewed restricted real-content row stays held
        // from sending until an admin/editor reviews it, regardless of
        // who's asking or that they can already see the text.
        assert.equal(item.needsReview, true);
        assert.equal(item.reviewedAt, null);
      }
    } finally {
      await prisma.pendingNotification.deleteMany({ where: { partnerId: restrictedId } });
      await prisma.partner.delete({ where: { id: restrictedId } }).catch(() => {});
    }
  });
});

describe("DELETE /api/notifications/pending/:id", () => {
  test("viewer is rejected, admin can clear a queued row without sending it", async () => {
    const requestText = `${FIXTURE_TAG} cleared before it ever goes out`;
    await createPrayerRequest(requestText);
    const row = await prisma.pendingNotification.findFirst({
      where: { partnerId, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row, "fixture setup: the row should be queued");

    assert.equal((await viewer(`/api/notifications/pending/${row.id}`, { method: "DELETE" })).status, 403);

    const res = await admin(`/api/notifications/pending/${row.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);

    const stillThere = await prisma.pendingNotification.findUnique({ where: { id: row.id } });
    assert.equal(stillThere, null, "the row should be gone, not just marked sent");
  });

  test("clearing an already-gone id 404s instead of throwing", async () => {
    const res = await admin("/api/notifications/pending/not-a-real-id", { method: "DELETE" });
    assert.equal(res.status, 404);
  });
});

describe("restricted-partner notification review & edit (#187)", () => {
  let restrictedPartnerId;

  before(async () => {
    const restrictedPartner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} review flow partner`, isRestricted: true },
    });
    assert.equal(restrictedPartner.status, 201, JSON.stringify(restrictedPartner.body));
    restrictedPartnerId = restrictedPartner.body.id;
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { queueNotifyPrayerRequests: true, queueNotifyRestrictedPartners: true },
    });
  });

  after(async () => {
    await prisma.pendingNotification.deleteMany({ where: { partnerId: restrictedPartnerId } });
    await prisma.partner.delete({ where: { id: restrictedPartnerId } }).catch(() => {});
  });

  async function createRestrictedPrayerRequest(requestText) {
    const res = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId: restrictedPartnerId,
        category: "situational",
        requestText,
        dateReceived: "2026-01-01",
      },
    });
    assert.equal(res.status, 201, `fixture setup failed: ${JSON.stringify(res.body)}`);
  }

  function findPendingRow(requestText) {
    return prisma.pendingNotification.findFirst({
      where: { partnerId: restrictedPartnerId, payload: { path: ["requestText"], equals: requestText } },
    });
  }

  test("a flush excludes an unapproved restricted row from both channels", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true, outboundEmail: false } },
    });
    await admin("/api/settings/groupme", {
      method: "PUT",
      body: { accessToken: "fake-token", prayerTopicId: "fake-prayer-topic" },
    });

    const requestText = `${FIXTURE_TAG} held for review`;
    await createRestrictedPrayerRequest(requestText);

    mockGroupMe(async () => groupmeJson(202, { response: null }));
    try {
      const res = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(res.status, 200);
      assert.ok(res.body.heldForReview >= 1, JSON.stringify(res.body));

      const row = await findPendingRow(requestText);
      assert.ok(row, "the row must remain queued, not sent");
      assert.equal(row.groupmeSentAt, null);
      assert.equal(row.emailSentAt, null);
    } finally {
      unmockAll();
    }
  });

  test("after PUT with edited text, a subsequent flush does send it -- still masked name, no source link", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true, outboundEmail: false } },
    });

    const requestText = `${FIXTURE_TAG} will be edited then sent`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    const editedText = "Pray for wisdom in an upcoming transition.";
    const putRes = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.needsReview, false);

    let capturedText = null;
    mockGroupMe(async (url, options) => {
      capturedText = JSON.parse(options.body).message.text;
      return groupmeJson(202, { response: null });
    });
    try {
      const sendRes = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(sendRes.status, 200);
      assert.ok(capturedText.includes(editedText), capturedText);
      assert.ok(!capturedText.includes(requestText), "the original real text should not appear");
      assert.ok(!capturedText.includes("review flow partner"), "the real partner name must not leak");

      const finalRow = await prisma.pendingNotification.findUnique({ where: { id: row.id } });
      assert.equal(finalRow, null, "a successfully-sent row should be cleared");
    } finally {
      unmockAll();
    }
  });

  test("editing a non-restricted row's text takes effect on send, with no prior hold", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true, outboundEmail: false } },
    });

    const requestText = `${FIXTURE_TAG} non-restricted, will be edited`;
    await createPrayerRequest(requestText);
    const row = await prisma.pendingNotification.findFirst({
      where: { partnerId, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row);

    const editedText = "Edited wording for the team to see.";
    const putRes = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);
    // Not restricted, so this was never held in the first place.
    assert.equal(putRes.body.needsReview, false);

    let capturedText = null;
    mockGroupMe(async (url, options) => {
      capturedText = JSON.parse(options.body).message.text;
      return groupmeJson(202, { response: null });
    });
    try {
      const sendRes = await admin("/api/notifications/send", { method: "POST" });
      assert.equal(sendRes.status, 200);
      assert.ok(capturedText.includes(editedText), capturedText);
    } finally {
      unmockAll();
    }
  });

  test("GET /pending/:id -- role gate and real unmasked content", async () => {
    const requestText = `${FIXTURE_TAG} reveal real text`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    assert.equal((await viewer(`/api/notifications/pending/${row.id}`)).status, 403);

    const res = await admin(`/api/notifications/pending/${row.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.rawText, requestText, "reveal must return the real text, not the placeholder");

    assert.equal((await admin("/api/notifications/pending/not-a-real-id")).status, 404);
  });

  test("PUT /pending/:id -- validation", async () => {
    const requestText = `${FIXTURE_TAG} validation check`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    assert.equal(
      (await admin(`/api/notifications/pending/${row.id}`, { method: "PUT", body: { text: "" } })).status,
      400
    );
    assert.equal(
      (await viewer(`/api/notifications/pending/${row.id}`, { method: "PUT", body: { text: "fine" } }))
        .status,
      403
    );
    assert.equal(
      (await admin("/api/notifications/pending/not-a-real-id", { method: "PUT", body: { text: "fine" } }))
        .status,
      404
    );
  });

  test("editing a restricted row twice overwrites reviewedText/reviewedById/reviewedAt each time", async () => {
    const requestText = `${FIXTURE_TAG} edited twice`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    const first = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: "First edit." },
    });
    assert.equal(first.status, 200);
    const afterFirst = await prisma.pendingNotification.findUnique({ where: { id: row.id } });
    assert.equal(afterFirst.reviewedText, "First edit.");
    assert.ok(afterFirst.reviewedById, "reviewedById should be set");

    const second = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: "Second edit, cleaner." },
    });
    assert.equal(second.status, 200);
    const afterSecond = await prisma.pendingNotification.findUnique({ where: { id: row.id } });
    assert.equal(afterSecond.reviewedText, "Second edit, cleaner.");
    assert.ok(afterSecond.reviewedAt.getTime() >= afterFirst.reviewedAt.getTime());
  });

  test("queueNotifyRestrictedPartners: false -- a restricted partner's event is never queued at all", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { queueNotifyRestrictedPartners: false },
    });
    try {
      const requestText = `${FIXTURE_TAG} should never be queued`;
      const res = await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId: restrictedPartnerId,
          category: "situational",
          requestText,
          dateReceived: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);

      const row = await findPendingRow(requestText);
      assert.equal(row, null, "no PendingNotification row should ever be created");
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { queueNotifyRestrictedPartners: true },
      });
    }
  });

  test("queueNotifyRestrictedPartners: true (default) -- the row is created and starts needing review", async () => {
    const requestText = `${FIXTURE_TAG} queued normally, needs review`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row, "row should be queued");

    const listed = await admin("/api/notifications/pending");
    const item = listed.body.find((i) => i.id === row.id);
    assert.ok(item);
    assert.equal(item.needsReview, true);
    assert.equal(item.reviewedAt, null);
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
