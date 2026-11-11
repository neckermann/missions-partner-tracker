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
      chatDispatchPrayerRequests: true,
      chatDispatchOneTimeNeeds: true,
      chatDispatchNewsletters: true,
      allowRestrictedPartnerDispatch: true,
      emailDispatchSubjectTemplate: true,
      emailDispatchSignature: true,
      emailDispatchLayout: true,
      emailDispatchDayOfWeek: true,
      emailDispatchDayOfMonth: true,
      emailDispatchHour: true,
      chatDispatchHour: true,
      churchName: true,
      address: true,
      phone: true,
      websiteLink: true,
      partnerTermSingular: true,
    },
  });
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: {},
      chatDispatchPrayerRequests: true,
      chatDispatchOneTimeNeeds: true,
      chatDispatchNewsletters: true,
      allowRestrictedPartnerDispatch: true,
      emailDispatchDayOfWeek: null,
      emailDispatchDayOfMonth: null,
      emailDispatchHour: null,
      chatDispatchHour: null,
    },
    create: { id: "singleton" },
  });

  await removeFixturePartners();
  const partner = await (
    await client("admin")
  )("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} notifications target` },
  });
  partnerId = partner.body.id;
});

after(async () => {
  await prisma.dispatchRecord.deleteMany({ where: { partnerId } });
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/dispatches -- admin gate and defaults", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/dispatches")).status, 401);
  });

  test("editor is rejected", async () => {
    assert.equal((await editor("/api/settings/dispatches")).status, 403);
  });

  test("admin sees the defaults on an unconfigured instance", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        chatDispatchPrayerRequests: true,
        chatDispatchOneTimeNeeds: true,
        chatDispatchNewsletters: true,
        allowRestrictedPartnerDispatch: true,
        emailDispatchSubjectTemplate: null,
        emailDispatchSignature: null,
        emailDispatchLayout: null,
        emailDispatchDayOfWeek: null,
        emailDispatchDayOfMonth: null,
        emailDispatchHour: null,
        chatDispatchHour: null,
      },
    });
    const res = await admin("/api/settings/dispatches");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      chatDispatchPrayerRequests: true,
      chatDispatchOneTimeNeeds: true,
      chatDispatchNewsletters: true,
      allowRestrictedPartnerDispatch: true,
      emailDispatchSubjectTemplate: null,
      emailDispatchSignature: null,
      emailDispatchLayout: null,
      emailDispatchDayOfWeek: null,
      emailDispatchDayOfMonth: null,
      emailDispatchHour: null,
      chatDispatchHour: null,
    });
  });

  test("a partial PUT can also set the scoped-digest schedule, independent of the fields above", async () => {
    const res = await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { emailDispatchDayOfWeek: 3, emailDispatchHour: 9 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.emailDispatchDayOfWeek, 3);
    assert.equal(res.body.emailDispatchHour, 9);
    assert.equal(res.body.emailDispatchDayOfMonth, null);

    await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { emailDispatchDayOfWeek: null, emailDispatchHour: null },
    });
  });

  test("a partial PUT can also set GroupMe's own daily hour, independent of the email tiers above", async () => {
    const res = await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { chatDispatchHour: 8 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.chatDispatchHour, 8);
    await admin("/api/settings/dispatches", { method: "PUT", body: { chatDispatchHour: null } });
  });

  test("a partial PUT only touches the fields it sends", async () => {
    const first = await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { emailDispatchDayOfWeek: 1, emailDispatchHour: 9 },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.emailDispatchDayOfWeek, 1);

    const second = await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { chatDispatchNewsletters: false },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.chatDispatchNewsletters, false);
    assert.equal(second.body.emailDispatchDayOfWeek, 1, "the earlier schedule save must survive");

    await admin("/api/settings/dispatches", {
      method: "PUT",
      body: { emailDispatchDayOfWeek: null, emailDispatchHour: null, chatDispatchNewsletters: true },
    });
  });
});

describe("GET /api/dispatches/pending -- any logged-in role", () => {
  test("a viewer can list the queue", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    const requestText = `${FIXTURE_TAG} viewer can see this`;
    await createPrayerRequest(requestText);

    const res = await viewer("/api/dispatches/pending");
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
      for (const asRole of [admin, editor, viewer]) {
        const res = await asRole("/api/dispatches/pending");
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
        assert.equal(item.needsReview, true);
        assert.equal(item.dispatchReviewedAt, null);
      }
    } finally {
      await prisma.dispatchRecord.deleteMany({ where: { partnerId: restrictedId } });
      await prisma.partner.delete({ where: { id: restrictedId } }).catch(() => {});
    }
  });

  test("a restricted partner's newsletter is never held for review -- buildBlurb already fully suppresses its content", async () => {
    const restrictedPartner = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} restricted newsletter partner`,
        isRestricted: true,
      },
    });
    const restrictedId = restrictedPartner.body.id;
    const row = await prisma.dispatchRecord.create({
      data: {
        partnerId: restrictedId,
        type: "newsletterCreated",
        payload: { partnerName: restrictedPartner.body.displayName, newsletterId: "fake-id" },
      },
    });
    try {
      const res = await admin("/api/dispatches/pending");
      const item = res.body.find((i) => i.id === row.id);
      assert.ok(item, "the row should still be listed");
      assert.equal(item.needsReview, false, "newsletters are review-exempt even for a restricted partner");
    } finally {
      await prisma.dispatchRecord.deleteMany({ where: { partnerId: restrictedId } });
      await prisma.partner.delete({ where: { id: restrictedId } }).catch(() => {});
    }
  });
});

describe("GET /api/dispatches/urgent-recipient-count", () => {
  test("requires admin or editor", async () => {
    assert.equal(
      (await unauthenticated(`/api/dispatches/urgent-recipient-count?partnerId=${partnerId}`)).status,
      401
    );
    assert.equal((await viewer(`/api/dispatches/urgent-recipient-count?partnerId=${partnerId}`)).status, 403);
  });

  test("returns real counts, cadence-blind, when outboundEmail and publicPrayerDigest are both on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, publicPrayerDigest: true } },
    });
    const sub = await prisma.publicSubscriber.create({
      data: { email: "urgent-count-test@example.test", confirmedAt: new Date(), allPartners: true },
    });
    try {
      const res = await admin(`/api/dispatches/urgent-recipient-count?partnerId=${partnerId}`);
      assert.equal(res.status, 200);
      assert.ok(typeof res.body.adminCount === "number");
      assert.ok(res.body.publicCount >= 1);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: sub.id } });
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    }
  });

  // The confirm dialog's numbers must agree with what sendUrgentDispatch
  // will actually do -- with outboundEmail off, it never attempts an
  // email send at all (see dispatchOrchestrator.js's own gating), so
  // showing real subscriber counts here would overstate what's about to
  // happen.
  test("returns 0 for both counts when outboundEmail is off, even with real subscribers on file", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    const sub = await prisma.publicSubscriber.create({
      data: { email: "urgent-count-test-off@example.test", confirmedAt: new Date(), allPartners: true },
    });
    try {
      const res = await admin(`/api/dispatches/urgent-recipient-count?partnerId=${partnerId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.adminCount, 0);
      assert.equal(res.body.publicCount, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: sub.id } });
    }
  });

  // publicPrayerDigest off must zero the public count even though
  // outboundEmail is on -- the gap this test is named for: the admin
  // digest's own gate (outboundEmail) is not enough to assume the public
  // digest is also allowed to send.
  test("returns a real admin count but 0 public count when outboundEmail is on and publicPrayerDigest is off", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, publicPrayerDigest: false } },
    });
    const sub = await prisma.publicSubscriber.create({
      data: {
        email: "urgent-count-test-nopublicdigest@example.test",
        confirmedAt: new Date(),
        allPartners: true,
      },
    });
    try {
      const res = await admin(`/api/dispatches/urgent-recipient-count?partnerId=${partnerId}`);
      assert.equal(res.status, 200);
      assert.ok(typeof res.body.adminCount === "number");
      assert.equal(res.body.publicCount, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: sub.id } });
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    }
  });
});

describe("DELETE /api/dispatches/pending/:id", () => {
  test("viewer is rejected, admin can clear a queued row without sending it", async () => {
    const requestText = `${FIXTURE_TAG} cleared before it ever goes out`;
    await createPrayerRequest(requestText);
    const row = await prisma.dispatchRecord.findFirst({
      where: { partnerId, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row, "fixture setup: the row should be queued");

    assert.equal((await viewer(`/api/dispatches/pending/${row.id}`, { method: "DELETE" })).status, 403);

    const res = await admin(`/api/dispatches/pending/${row.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);

    const stillThere = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.equal(stillThere, null, "the row should be gone, not just marked sent");
  });

  test("clearing an already-gone id 404s instead of throwing", async () => {
    const res = await admin("/api/dispatches/pending/not-a-real-id", { method: "DELETE" });
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
      data: { allowRestrictedPartnerDispatch: true },
    });
  });

  after(async () => {
    await prisma.dispatchRecord.deleteMany({ where: { partnerId: restrictedPartnerId } });
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
    return prisma.dispatchRecord.findFirst({
      where: { partnerId: restrictedPartnerId, payload: { path: ["requestText"], equals: requestText } },
    });
  }

  test("an unreviewed restricted row lists with needsReview: true", async () => {
    const requestText = `${FIXTURE_TAG} held for review`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);
    const res = await admin("/api/dispatches/pending");
    const item = res.body.find((i) => i.id === row.id);
    assert.equal(item.needsReview, true);
    assert.equal(row.groupmeDispatchedAt, null);
  });

  test("PUT with edited text clears the hold -- needsReview: false afterward", async () => {
    const requestText = `${FIXTURE_TAG} will be edited then cleared`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    const editedText = "Pray for wisdom in an upcoming transition.";
    const putRes = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.needsReview, false);
    assert.ok(!putRes.body.bodyText.includes(requestText));
    assert.ok(!putRes.body.partnerName?.includes("review flow partner"));

    const updated = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.equal(updated.dispatchReviewedText, editedText);
  });

  test("editing a non-restricted row's text takes effect, with no prior hold", async () => {
    const requestText = `${FIXTURE_TAG} non-restricted, will be edited`;
    await createPrayerRequest(requestText);
    const row = await prisma.dispatchRecord.findFirst({
      where: { partnerId, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row);

    const editedText = "Edited wording for the team to see.";
    const putRes = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.needsReview, false);
    assert.equal(putRes.body.bodyText, editedText);
  });

  test("GET /pending/:id -- role gate and real unmasked content", async () => {
    const requestText = `${FIXTURE_TAG} reveal real text`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    assert.equal((await viewer(`/api/dispatches/pending/${row.id}`)).status, 403);

    const res = await admin(`/api/dispatches/pending/${row.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.rawText, requestText, "reveal must return the real text, not the placeholder");

    assert.equal((await admin("/api/dispatches/pending/not-a-real-id")).status, 404);
  });

  test("PUT /pending/:id -- validation", async () => {
    const requestText = `${FIXTURE_TAG} validation check`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    assert.equal(
      (await admin(`/api/dispatches/pending/${row.id}`, { method: "PUT", body: { text: "" } })).status,
      400
    );
    assert.equal(
      (await viewer(`/api/dispatches/pending/${row.id}`, { method: "PUT", body: { text: "fine" } })).status,
      403
    );
    assert.equal(
      (await admin("/api/dispatches/pending/not-a-real-id", { method: "PUT", body: { text: "fine" } }))
        .status,
      404
    );
  });

  test("editing a restricted row twice overwrites dispatchReviewedText/dispatchReviewedById/dispatchReviewedAt each time", async () => {
    const requestText = `${FIXTURE_TAG} edited twice`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row);

    const first = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: "First edit." },
    });
    assert.equal(first.status, 200);
    const afterFirst = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.equal(afterFirst.dispatchReviewedText, "First edit.");
    assert.ok(afterFirst.dispatchReviewedById, "dispatchReviewedById should be set");

    const second = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: "Second edit, cleaner." },
    });
    assert.equal(second.status, 200);
    const afterSecond = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.equal(afterSecond.dispatchReviewedText, "Second edit, cleaner.");
    assert.ok(afterSecond.dispatchReviewedAt.getTime() >= afterFirst.dispatchReviewedAt.getTime());
  });

  test("allowRestrictedPartnerDispatch: false -- a restricted partner's event is never recorded at all", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { allowRestrictedPartnerDispatch: false },
    });
    try {
      const requestText = `${FIXTURE_TAG} should never be recorded`;
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
      assert.equal(row, null, "no DispatchRecord row should ever be created");
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { allowRestrictedPartnerDispatch: true },
      });
    }
  });

  test("allowRestrictedPartnerDispatch: true -- the row is created and starts needing review", async () => {
    const requestText = `${FIXTURE_TAG} queued normally, needs review`;
    await createRestrictedPrayerRequest(requestText);
    const row = await findPendingRow(requestText);
    assert.ok(row, "row should be queued");

    const listed = await admin("/api/dispatches/pending");
    const item = listed.body.find((i) => i.id === row.id);
    assert.ok(item);
    assert.equal(item.needsReview, true);
    assert.equal(item.dispatchReviewedAt, null);
  });

  // The inline "approve now" path from the creation form, bypassing the
  // separate trip to Pending Notifications -- POST /prayer-requests
  // itself accepts approveNow and threads it through to createDispatchRecord.
  test("approveNow: true on creation records the row already reviewed, with requestText as the reviewed text", async () => {
    const requestText = `${FIXTURE_TAG} approved inline at creation`;
    const res = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId: restrictedPartnerId,
        category: "situational",
        requestText,
        dateReceived: "2026-01-01",
        approveNow: true,
      },
    });
    assert.equal(res.status, 201);

    const row = await findPendingRow(requestText);
    assert.ok(row, "row should be queued");
    assert.ok(row.dispatchReviewedAt, "dispatchReviewedAt should already be set");
    assert.equal(row.dispatchReviewedText, requestText);
    assert.ok(row.dispatchReviewedById);

    const listed = await admin("/api/dispatches/pending");
    const item = listed.body.find((i) => i.id === row.id);
    assert.equal(item.needsReview, false, "already reviewed -- not held");
  });

  test("approveNow: false (default, box unchecked) still queues held for review, same as before", async () => {
    const requestText = `${FIXTURE_TAG} not approved inline`;
    const res = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId: restrictedPartnerId,
        category: "situational",
        requestText,
        dateReceived: "2026-01-01",
        approveNow: false,
      },
    });
    assert.equal(res.status, 201);

    const row = await findPendingRow(requestText);
    assert.ok(row);
    assert.equal(row.dispatchReviewedAt, null);
  });
});

describe("unsubscribe", () => {
  test("GET /api/auth/unsubscribe with a valid token clears cadence", async () => {
    await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "biweekly", allPartners: true },
    });
    const me = await admin("/api/auth/me");
    assert.equal(me.body.user.cadence, "biweekly");

    const jwt = require("jsonwebtoken");
    const token = jwt.sign({ id: me.body.user.id, unsubscribe: true }, process.env.SESSION_SECRET);
    const res = await unauthenticated(`/api/auth/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);

    const after = await admin("/api/auth/me");
    assert.equal(after.body.user.cadence, null);
  });

  test("an invalid token is rejected", async () => {
    assert.equal((await unauthenticated("/api/auth/unsubscribe?token=garbage")).status, 400);
  });

  test("a missing token is rejected", async () => {
    assert.equal((await unauthenticated("/api/auth/unsubscribe")).status, 400);
  });
});

describe("PUT /api/auth/dispatch-by-email -- cadence + scope", () => {
  let partnerA;
  let partnerB;

  before(async () => {
    const a = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} digest scope A` },
    });
    const b = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} digest scope B` },
    });
    partnerA = a.body.id;
    partnerB = b.body.id;
  });

  after(async () => {
    await admin("/api/auth/dispatch-by-email", { method: "PUT", body: { cadence: null, allPartners: true } });
    await removeFixturePartners();
  });

  test("cadence + specific partners persists and GET /me reflects it", async () => {
    const res = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "biweekly", allPartners: false, partnerIds: [partnerA, partnerB] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.cadence, "biweekly");
    assert.equal(res.body.user.allPartners, false);
    assert.deepEqual(res.body.user.followedPartnerIds.sort(), [partnerA, partnerB].sort());

    const me = await admin("/api/auth/me");
    assert.equal(me.body.user.cadence, "biweekly");
    assert.deepEqual(me.body.user.followedPartnerIds.sort(), [partnerA, partnerB].sort());
  });

  test("cadence: null clears the subscription and any followed partners", async () => {
    await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: [partnerA] },
    });
    const res = await admin("/api/auth/dispatch-by-email", { method: "PUT", body: { cadence: null } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.cadence, null);
    assert.deepEqual(res.body.user.followedPartnerIds, []);

    const me = await admin("/api/auth/me");
    assert.deepEqual(me.body.user.followedPartnerIds, []);
  });

  test("switching to allPartners: true clears previously followed partners, not just ignores them", async () => {
    await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: [partnerA, partnerB] },
    });
    const res = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.allPartners, true);
    assert.deepEqual(res.body.user.followedPartnerIds, []);

    const rescoped = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: [partnerA] },
    });
    assert.deepEqual(rescoped.body.user.followedPartnerIds, [partnerA]);
  });

  test("a non-existent or archived partner id is rejected with a 400, not silently dropped", async () => {
    const archived = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} digest scope archived` },
    });
    await admin(`/api/partners/${archived.body.id}/archive`, { method: "POST" });

    const bogus = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: ["not-a-real-id"] },
    });
    assert.equal(bogus.status, 400);

    const archivedRes = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: [archived.body.id] },
    });
    assert.equal(archivedRes.status, 400);
  });

  test("allPartners: false with an empty partnerIds list is rejected", async () => {
    const res = await admin("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", allPartners: false, partnerIds: [] },
    });
    assert.equal(res.status, 400);
  });

  test("an invalid cadence is rejected", async () => {
    const res = await admin("/api/auth/dispatch-by-email", { method: "PUT", body: { cadence: "weekly" } });
    assert.equal(res.status, 400);
  });

  test("non-admin roles can set their own digest preference too", async () => {
    const editorClient = await client("editor");
    const res = await editorClient("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "quarterly", allPartners: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.cadence, "quarterly");
    await editorClient("/api/auth/dispatch-by-email", { method: "PUT", body: { cadence: null } });
  });
});
