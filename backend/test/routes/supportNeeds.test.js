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

// Role gating, zod validation, and the notify-only-on-genuine-transition
// behavior for /api/support-needs -- no dedicated test file existed before
// (#276). Unlike prayerRequests.test.js, approveNow and the restricted-
// partner recording block are tested directly here too: dispatches.test.js
// only ever exercises those two behaviors through POST /api/prayer-requests,
// never through this route, so support needs had zero coverage of either
// one. isUrgent's actual cross-channel send behavior stays owned by
// dispatchOrchestrator.test.js's direct unit tests -- this file only
// confirms the field is accepted and awaited.

let admin;
let editor;
let viewer;
let unauthenticated;
let partnerId;
let restrictedPartnerId;
let originalSettings;

async function create(body) {
  return admin("/api/support-needs", { method: "POST", body: { partnerId, ...body } });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { allowRestrictedPartnerDispatch: true },
  });

  await removeFixturePartners();
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} support needs target` },
  });
  partnerId = partner.body.id;

  const restricted = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} support needs restricted`, isRestricted: true },
  });
  restrictedPartnerId = restricted.body.id;
});

after(async () => {
  await prisma.dispatchRecord.deleteMany({ where: { partnerId: { in: [partnerId, restrictedPartnerId] } } });
  await removeFixturePartners();
  await removeTestUsers();
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await stopServer();
});

describe("GET /api/support-needs", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/support-needs")).status, 401);
  });

  test("a viewer can list, filtered by partnerId", async () => {
    const res = await create({
      description: `${FIXTURE_TAG} list check`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });
    assert.equal(res.status, 201);

    const listed = await viewer(`/api/support-needs?partnerId=${partnerId}`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((r) => r.id === res.body.id));
    assert.ok(listed.body.every((r) => r.partnerId === partnerId));
  });
});

describe("POST /api/support-needs", () => {
  test("viewer is rejected", async () => {
    const res = await viewer("/api/support-needs", {
      method: "POST",
      body: { partnerId, description: "x", requestedAmount: 100, requestDate: "2026-01-01" },
    });
    assert.equal(res.status, 403);
  });

  test("editor can create", async () => {
    const res = await editor("/api/support-needs", {
      method: "POST",
      body: {
        partnerId,
        description: `${FIXTURE_TAG} editor create`,
        requestedAmount: 250,
        requestDate: "2026-01-01",
      },
    });
    assert.equal(res.status, 201);
  });

  test("missing description is rejected", async () => {
    const res = await create({ description: "", requestedAmount: 100, requestDate: "2026-01-01" });
    assert.equal(res.status, 400);
  });

  test("approvedAmount without approvedDate (or vice versa) is rejected", async () => {
    const onlyAmount = await create({
      description: `${FIXTURE_TAG} only amount`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      approvedAmount: 100,
    });
    assert.equal(onlyAmount.status, 400);

    const onlyDate = await create({
      description: `${FIXTURE_TAG} only date`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      approvedDate: "2026-02-01",
    });
    assert.equal(onlyDate.status, 400);
  });

  test("approvedAmount and approvedDate together succeed", async () => {
    const res = await create({
      description: `${FIXTURE_TAG} decided at creation`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      approvedAmount: 80,
      approvedDate: "2026-02-01",
    });
    assert.equal(res.status, 201);
  });

  test("isUrgent: true is accepted and doesn't crash the request", async () => {
    const res = await create({
      description: `${FIXTURE_TAG} urgent smoke test`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      isUrgent: true,
    });
    assert.equal(res.status, 201);
  });

  describe("restricted partner", () => {
    test("allowRestrictedPartnerDispatch: false -- the event is never recorded at all", async () => {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { allowRestrictedPartnerDispatch: false },
      });
      try {
        const description = `${FIXTURE_TAG} should never be recorded`;
        const res = await admin("/api/support-needs", {
          method: "POST",
          body: {
            partnerId: restrictedPartnerId,
            description,
            requestedAmount: 100,
            requestDate: "2026-01-01",
          },
        });
        assert.equal(res.status, 201);

        const row = await prisma.dispatchRecord.findFirst({
          where: { partnerId: restrictedPartnerId, payload: { path: ["description"], equals: description } },
        });
        assert.equal(row, null, "no DispatchRecord row should ever be created");
      } finally {
        await prisma.churchSettings.update({
          where: { id: "singleton" },
          data: { allowRestrictedPartnerDispatch: true },
        });
      }
    });

    test("approveNow: true records the row already reviewed, with description as the reviewed text", async () => {
      const description = `${FIXTURE_TAG} approved inline at creation`;
      const res = await admin("/api/support-needs", {
        method: "POST",
        body: {
          partnerId: restrictedPartnerId,
          description,
          requestedAmount: 100,
          requestDate: "2026-01-01",
          approveNow: true,
        },
      });
      assert.equal(res.status, 201);

      const row = await prisma.dispatchRecord.findFirst({
        where: { partnerId: restrictedPartnerId, payload: { path: ["description"], equals: description } },
      });
      assert.ok(row, "row should be queued");
      assert.ok(row.dispatchReviewedAt, "dispatchReviewedAt should already be set");
      assert.equal(row.dispatchReviewedText, description);
      assert.ok(row.dispatchReviewedById);
    });

    test("approveNow: false (default) still queues held for review", async () => {
      const description = `${FIXTURE_TAG} not approved inline`;
      const res = await admin("/api/support-needs", {
        method: "POST",
        body: {
          partnerId: restrictedPartnerId,
          description,
          requestedAmount: 100,
          requestDate: "2026-01-01",
        },
      });
      assert.equal(res.status, 201);

      const row = await prisma.dispatchRecord.findFirst({
        where: { partnerId: restrictedPartnerId, payload: { path: ["description"], equals: description } },
      });
      assert.ok(row);
      assert.equal(row.dispatchReviewedAt, null);
    });
  });
});

describe("PUT /api/support-needs/:id", () => {
  test("viewer is rejected", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} put role gate`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });
    const res = await viewer(`/api/support-needs/${created.body.id}`, {
      method: "PUT",
      body: { notes: "nope" },
    });
    assert.equal(res.status, 403);
  });

  test("editing a field other than the decision creates no dispatch record", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} edit notes only`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });
    const before = await prisma.dispatchRecord.count({ where: { partnerId } });

    const res = await admin(`/api/support-needs/${created.body.id}`, {
      method: "PUT",
      body: { notes: "just a note" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({ where: { partnerId } });
    assert.equal(after, before, "editing an unrelated field must not notify");
  });

  test("a genuine decision transition creates exactly one supportNeedDecided dispatch record", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} genuine decision transition`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });
    const before = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });

    const res = await admin(`/api/support-needs/${created.body.id}`, {
      method: "PUT",
      body: { approvedAmount: 100, approvedDate: "2026-02-01", decisionNote: "Fully funded" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });
    assert.equal(after, before + 1);
  });

  test("re-saving an already-decided need does not notify again", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} already decided, re-saved`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      approvedAmount: 100,
      approvedDate: "2026-02-01",
    });
    const before = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });

    const res = await admin(`/api/support-needs/${created.body.id}`, {
      method: "PUT",
      body: { approvedAmount: 100, approvedDate: "2026-02-01", decisionNote: "typo fix" },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });
    assert.equal(after, before, "re-sending the same decision must not re-notify");
  });

  test("clearing a decision (both fields null) does not notify", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} decision cleared`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
      approvedAmount: 100,
      approvedDate: "2026-02-01",
    });
    const before = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });

    const res = await admin(`/api/support-needs/${created.body.id}`, {
      method: "PUT",
      body: { approvedAmount: null, approvedDate: null },
    });
    assert.equal(res.status, 200);

    const after = await prisma.dispatchRecord.count({ where: { partnerId, type: "supportNeedDecided" } });
    assert.equal(after, before);
  });
});

describe("DELETE /api/support-needs/:id", () => {
  test("editor is rejected, admin can delete", async () => {
    const created = await create({
      description: `${FIXTURE_TAG} delete test`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });

    assert.equal((await editor(`/api/support-needs/${created.body.id}`, { method: "DELETE" })).status, 403);

    const res = await admin(`/api/support-needs/${created.body.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(await prisma.supportNeed.findUnique({ where: { id: created.body.id } }), null);
  });
});
