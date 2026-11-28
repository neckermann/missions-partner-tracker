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

// Role gating, zod validation, and the notify-only-on-genuine-transition behavior for
// /api/prayer-requests. The approveNow/restricted-partner wiring is covered by
// dispatches.test.js and isUrgent's cross-channel send behavior by
// dispatchOrchestrator.test.js, so neither is re-tested here; this file only confirms isUrgent
// is accepted and awaited without the route throwing.

let admin;
let editor;
let viewer;
let unauthenticated;
let partnerId;

async function create(body) {
  return admin("/api/prayer-requests", { method: "POST", body: { partnerId, ...body } });
}

let originalFeatures;
before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalFeatures =
    (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures ?? {};
  // Records are only queued while some channel is on.
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { ...originalFeatures, outboundEmail: true } },
  });
  await removeFixturePartners();
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} prayer requests target` },
  });
  partnerId = partner.body.id;
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await prisma.dispatchRecord.deleteMany({ where: { partnerId } });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/prayer-requests", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/prayer-requests")).status, 401);
  });

  test("a viewer can list, filtered by partnerId", async () => {
    const res = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} list check`,
      dateReceived: "2026-01-01",
    });
    assert.equal(res.status, 201);

    const listed = await viewer(`/api/prayer-requests?partnerId=${partnerId}`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((r) => r.id === res.body.id));
    assert.ok(listed.body.every((r) => r.partnerId === partnerId));
  });

  // The admin list page hides an archived partner's requests by default
  // (AdminPrayerRequests.jsx), the same convention the matching report
  // (reports/prayerRequests.js) already applies server-side -- but that
  // page's filter is client-side, so what this route owes it is just the
  // partner's current archived state to filter on.
  test("a listed request's embedded partner carries its current archived state", async () => {
    const res = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} archived-state check`,
      dateReceived: "2026-01-01",
    });

    let listed = await viewer(`/api/prayer-requests?partnerId=${partnerId}`);
    const before = listed.body.find((r) => r.id === res.body.id);
    assert.equal(before.partner.archived, false);

    await admin(`/api/partners/${partnerId}/archive`, { method: "POST" });
    listed = await viewer(`/api/prayer-requests?partnerId=${partnerId}`);
    const after = listed.body.find((r) => r.id === res.body.id);
    assert.equal(after.partner.archived, true);

    await admin(`/api/partners/${partnerId}/unarchive`, { method: "POST" });
  });
});

describe("POST /api/prayer-requests", () => {
  test("viewer is rejected", async () => {
    const res = await viewer("/api/prayer-requests", {
      method: "POST",
      body: { partnerId, category: "situational", requestText: "x", dateReceived: "2026-01-01" },
    });
    assert.equal(res.status, 403);
  });

  test("editor can create", async () => {
    const res = await editor("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "strategic",
        requestText: `${FIXTURE_TAG} editor create`,
        dateReceived: "2026-01-01",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.partnerId, partnerId);
  });

  test("missing requestText is rejected", async () => {
    const res = await create({ category: "situational", requestText: "", dateReceived: "2026-01-01" });
    assert.equal(res.status, 400);
  });

  test("status: answered requires dateAnswered in the same request", async () => {
    const res = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} answered without date`,
      dateReceived: "2026-01-01",
      status: "answered",
    });
    assert.equal(res.status, 400);
  });

  test("status: answered with dateAnswered succeeds", async () => {
    const res = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} answered with date`,
      dateReceived: "2026-01-01",
      status: "answered",
      dateAnswered: "2026-02-01",
    });
    assert.equal(res.status, 201);
  });

  // Every channel is off in this test's church settings, so this only
  // confirms the route accepts the field and awaits the dispatch without
  // throwing -- see the file header comment for where the actual send
  // behavior is tested.
  test("isUrgent: true is accepted and doesn't crash the request", async () => {
    const res = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} urgent smoke test`,
      dateReceived: "2026-01-01",
      isUrgent: true,
    });
    assert.equal(res.status, 201);
  });
});

describe("PUT /api/prayer-requests/:id", () => {
  test("viewer is rejected", async () => {
    const created = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} put role gate`,
      dateReceived: "2026-01-01",
    });
    const res = await viewer(`/api/prayer-requests/${created.body.id}`, {
      method: "PUT",
      body: { notes: "nope" },
    });
    assert.equal(res.status, 403);
  });

  test("editing a field other than status creates no dispatch record", async () => {
    const created = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} edit notes only`,
      dateReceived: "2026-01-01",
    });
    const before = await prisma.dispatchRecord.count({ where: { partnerId } });

    const res = await admin(`/api/prayer-requests/${created.body.id}`, {
      method: "PUT",
      body: { notes: "just a note" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({ where: { partnerId } });
    assert.equal(after, before, "editing an unrelated field must not notify");
  });

  test("a genuine transition into status: answered creates exactly one prayerRequestAnswered dispatch record", async () => {
    const created = await create({
      category: "strategic",
      requestText: `${FIXTURE_TAG} genuine answer transition`,
      dateReceived: "2026-01-01",
    });
    const before = await prisma.dispatchRecord.count({
      where: { partnerId, type: "prayerRequestAnswered" },
    });

    const res = await admin(`/api/prayer-requests/${created.body.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-03-01", answeredNote: "Answered!" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({
      where: { partnerId, type: "prayerRequestAnswered" },
    });
    assert.equal(after, before + 1);
  });

  test("re-saving an already-answered request does not notify again", async () => {
    const created = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} already answered, re-saved`,
      dateReceived: "2026-01-01",
      status: "answered",
      dateAnswered: "2026-03-01",
    });
    const before = await prisma.dispatchRecord.count({
      where: { partnerId, type: "prayerRequestAnswered" },
    });

    const res = await admin(`/api/prayer-requests/${created.body.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-03-01", answeredNote: "typo fix" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({
      where: { partnerId, type: "prayerRequestAnswered" },
    });
    assert.equal(after, before, "re-sending the same status must not re-notify");
  });

  test("status: answered without dateAnswered is rejected on PUT too", async () => {
    const created = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} put answered validation`,
      dateReceived: "2026-01-01",
    });
    const res = await admin(`/api/prayer-requests/${created.body.id}`, {
      method: "PUT",
      body: { status: "answered" },
    });
    assert.equal(res.status, 400);
  });
});

describe("DELETE /api/prayer-requests/:id", () => {
  test("editor is rejected, admin can delete", async () => {
    const created = await create({
      category: "situational",
      requestText: `${FIXTURE_TAG} delete test`,
      dateReceived: "2026-01-01",
    });

    assert.equal((await editor(`/api/prayer-requests/${created.body.id}`, { method: "DELETE" })).status, 403);

    const res = await admin(`/api/prayer-requests/${created.body.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(await prisma.prayerRequest.findUnique({ where: { id: created.body.id } }), null);
  });
});
