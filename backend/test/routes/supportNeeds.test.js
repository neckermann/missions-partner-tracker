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
// /api/support-needs. Unlike prayerRequests.test.js, approveNow and the restricted-partner
// recording block are tested directly here: dispatches.test.js only exercises those through
// POST /api/prayer-requests. isUrgent's cross-channel send behavior stays owned by
// dispatchOrchestrator.test.js; this file only confirms the field is accepted and awaited.

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
    select: { allowRestrictedPartnerDispatch: true, enabledFeatures: true },
  });
  // Records are only queued while some channel is on.
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { ...(originalSettings?.enabledFeatures || {}), outboundEmail: true } },
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

describe("a need with no amount, and a decline", () => {
  test("can be raised with no amount (omitted, blank or null): saved as 0, meaning no amount", async () => {
    for (const requestedAmount of [undefined, "", null]) {
      const body = { description: `${FIXTURE_TAG} no amount`, requestDate: "2026-01-01" };
      if (requestedAmount !== undefined) body.requestedAmount = requestedAmount;
      const res = await create(body);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.requestedAmount, 0);
    }
  });

  test("editing a need without sending an amount leaves the stored amount alone", async () => {
    const made = await create({
      description: `${FIXTURE_TAG} keeps amount`,
      requestedAmount: 250,
      requestDate: "2026-01-01",
    });
    const res = await admin(`/api/support-needs/${made.body.id}`, {
      method: "PUT",
      body: { notes: "just a note" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.requestedAmount, 250);
  });

  test("a decision of $0 is a decline: it is recorded, and the need is no longer pending", async () => {
    const made = await create({
      description: `${FIXTURE_TAG} to decline`,
      requestedAmount: 500,
      requestDate: "2026-01-01",
    });
    const res = await admin(`/api/support-needs/${made.body.id}`, {
      method: "PUT",
      body: { approvedAmount: 0, approvedDate: "2026-02-01", decisionNote: "Not this year" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.approvedAmount, 0);
    assert.equal(res.body.decisionNote, "Not this year");
    const pending = await admin(`/api/support-needs?partnerId=${partnerId}&status=pending`);
    assert.ok(!pending.body.some((n) => n.id === made.body.id), "a declined need is no longer pending");
    const decided = await admin(`/api/support-needs?partnerId=${partnerId}&status=decided`);
    assert.ok(decided.body.some((n) => n.id === made.body.id));
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

// Where a need stands in real life (#511), apart from the funding decision: who has taken it on, and the day
// it was met. Both optional, both clearable, and neither touches the decision or sends anything.
describe("someone's on it / met", () => {
  const raise = async () => {
    const res = await create({
      description: `${FIXTURE_TAG} state test`,
      requestedAmount: 100,
      requestDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
    return res.body;
  };

  test("a new need has neither", async () => {
    const need = await raise();
    assert.equal(need.handledBy, null);
    assert.equal(need.metDate, null);
  });

  test("staff can say who is on it and when it was met, and the decision is untouched", async () => {
    const need = await raise();
    const on = await editor(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { handledBy: "  the deacons  " },
    });
    assert.equal(on.status, 200);
    assert.equal(on.body.handledBy, "the deacons");
    assert.equal(on.body.approvedAmount, null);

    const met = await editor(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { metDate: "2026-02-03" },
    });
    assert.equal(met.status, 200);
    assert.equal(String(met.body.metDate).slice(0, 10), "2026-02-03");
    assert.equal(met.body.handledBy, "the deacons", "an update that omits it leaves it alone");
    assert.equal(met.body.approvedAmount, null, "met is not a decision");
  });

  test("blank clears both", async () => {
    const need = await raise();
    await editor(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { handledBy: "x", metDate: "2026-02-03" },
    });
    const cleared = await editor(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { handledBy: "", metDate: "" },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.handledBy, null);
    assert.equal(cleared.body.metDate, null);
  });

  test("can be given when the need is raised", async () => {
    const res = await create({
      description: `${FIXTURE_TAG} raised already covered`,
      requestedAmount: 0,
      requestDate: "2026-01-01",
      handledBy: "Pastor Sam",
      metDate: "2026-01-02",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.handledBy, "Pastor Sam");
  });

  test("an over-long name and a bad date are refused; a viewer cannot set either", async () => {
    const need = await raise();
    const long = await editor(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { handledBy: "x".repeat(121) },
    });
    assert.equal(long.status, 400);
    const bad = await editor(`/api/support-needs/${need.id}`, { method: "PUT", body: { metDate: "soon" } });
    assert.equal(bad.status, 400);
    const asViewer = await viewer(`/api/support-needs/${need.id}`, {
      method: "PUT",
      body: { handledBy: "me" },
    });
    assert.equal(asViewer.status, 403);
  });

  test("a met need drops out of the care list's awaiting-a-decision count", async () => {
    const need = await raise();
    const count = () =>
      prisma.supportNeed.count({ where: { partnerId, approvedAmount: null, metDate: null } });
    const before = await count();
    await editor(`/api/support-needs/${need.id}`, { method: "PUT", body: { metDate: "2026-02-03" } });
    assert.equal(await count(), before - 1);
  });
});
