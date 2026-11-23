// Trip Leader (role: "tripLeader") -- a scoped guest account, not one of
// the 3 full roles. Covers the actual security boundary
// (requireTripScope/requirePartnerQueryScope, requireAuth.js): read/write
// on their own scoped trip, read-only on that trip's own linked Partner,
// 403 on everything else, and the expiresAt-as-revocation check. Also
// covers users.js's own validation that a tripLeader account can't exist
// without a real trip to scope it to.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const TRIP_LEADER_EMAIL = "route-test-tripleader@example.test";
const TRIP_LEADER_PASSWORD = "RouteTestTripLeader123!";

let admin;
let originalEnabledFeatures;
let partnerA;
let partnerB;
let tripA;
let tripB;

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), ...patch };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

function leaderClient() {
  return client({ email: TRIP_LEADER_EMAIL, password: TRIP_LEADER_PASSWORD });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();

  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({
    trips: true,
    prayerRequests: true,
    monthlySupport: true,
    oneTimeNeeds: true,
    partnerFiles: true,
  });

  const pa = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} tripLeaderA` },
  });
  partnerA = pa.body;
  const pb = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} tripLeaderB` },
  });
  partnerB = pb.body;

  const ta = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerA.id, status: "planning" },
  });
  tripA = ta.body;
  const tb = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerB.id, status: "planning" },
  });
  tripB = tb.body;

  const passwordHash = await bcrypt.hash(TRIP_LEADER_PASSWORD, 4); // low cost: throwaway fixture
  await prisma.user.upsert({
    where: { email: TRIP_LEADER_EMAIL },
    update: { passwordHash, role: "tripLeader", scopedTripId: tripA.id, expiresAt: null, active: true },
    create: {
      email: TRIP_LEADER_EMAIL,
      passwordHash,
      role: "tripLeader",
      scopedTripId: tripA.id,
      authProvider: "local",
      active: true,
    },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: TRIP_LEADER_EMAIL } });
  await removeFixturePartners(); // cascades both fixture trips
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("Trip Leader: trip scope", () => {
  test("reads their own trip", async () => {
    const leader = await leaderClient();
    const res = await leader(`/api/trips/${tripA.id}`);
    assert.equal(res.status, 200);
  });

  test("403s reading another trip", async () => {
    const leader = await leaderClient();
    const res = await leader(`/api/trips/${tripB.id}`);
    assert.equal(res.status, 403);
  });

  test("writes their own trip (editor-equivalent)", async () => {
    const leader = await leaderClient();
    const res = await leader(`/api/trips/${tripA.id}`, {
      method: "PUT",
      body: { notes: "trip leader note" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.notes, "trip leader note");
  });

  test("403s writing another trip", async () => {
    const leader = await leaderClient();
    const res = await leader(`/api/trips/${tripB.id}`, { method: "PUT", body: { notes: "nope" } });
    assert.equal(res.status, 403);
  });

  test("cannot delete their own trip -- stays admin-only", async () => {
    const leader = await leaderClient();
    const res = await leader(`/api/trips/${tripA.id}`, { method: "DELETE" });
    assert.equal(res.status, 403);
  });

  test("cannot clone or generate an application link for their own trip", async () => {
    const leader = await leaderClient();
    const clone = await leader(`/api/trips/${tripA.id}/clone`, { method: "POST" });
    assert.equal(clone.status, 403);
    const link = await leader(`/api/trips/${tripA.id}/generate-application-link`, { method: "POST" });
    assert.equal(link.status, 403);
  });

  test("full CRUD on a budget line scoped to their own trip", async () => {
    const leader = await leaderClient();
    const created = await leader(`/api/trips/${tripA.id}/budget-lines`, {
      method: "POST",
      body: { label: "Flights", estimatedAmount: 500 },
    });
    assert.equal(created.status, 201);
    const updated = await leader(`/api/trips/budget-lines/${created.body.id}`, {
      method: "PUT",
      body: { estimatedAmount: 600 },
    });
    assert.equal(updated.status, 200);
    const deleted = await leader(`/api/trips/budget-lines/${created.body.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
  });

  test("403s a budget line that belongs to another trip", async () => {
    const otherLine = await admin(`/api/trips/${tripB.id}/budget-lines`, {
      method: "POST",
      body: { label: "Lodging", estimatedAmount: 300 },
    });
    assert.equal(otherLine.status, 201);
    const leader = await leaderClient();
    const res = await leader(`/api/trips/budget-lines/${otherLine.body.id}`, {
      method: "PUT",
      body: { estimatedAmount: 1 },
    });
    assert.equal(res.status, 403);
  });

  test("403s the cross-trip list, but their own partner-scoped query works", async () => {
    const leader = await leaderClient();
    const bare = await leader("/api/trips");
    assert.equal(bare.status, 403);
    const planning = await leader("/api/trips/planning");
    assert.equal(planning.status, 403);
    const scoped = await leader(`/api/trips?partnerId=${partnerA.id}`);
    assert.equal(scoped.status, 200);
    const wrongScope = await leader(`/api/trips?partnerId=${partnerB.id}`);
    assert.equal(wrongScope.status, 403);
  });
});

describe("Trip Leader: partner scope", () => {
  test("reads only the one Partner tied to their own trip", async () => {
    const leader = await leaderClient();
    const ok = await leader(`/api/partners/${partnerA.id}`);
    assert.equal(ok.status, 200);
    const blocked = await leader(`/api/partners/${partnerB.id}`);
    assert.equal(blocked.status, 403);
  });

  test("403s the partner directory list", async () => {
    const leader = await leaderClient();
    const res = await leader("/api/partners");
    assert.equal(res.status, 403);
  });

  test("403s another partner's prayer requests even via query filter, allows their own", async () => {
    const leader = await leaderClient();
    const blocked = await leader(`/api/prayer-requests?partnerId=${partnerB.id}`);
    assert.equal(blocked.status, 403);
    const ok = await leader(`/api/prayer-requests?partnerId=${partnerA.id}`);
    assert.equal(ok.status, 200);
    const unfiltered = await leader("/api/prayer-requests");
    assert.equal(unfiltered.status, 403);
  });
});

describe("Trip Leader: Monthly Support / One-Time Needs blocked, Newsletters & Docs allowed", () => {
  let fileA;
  let fileB;

  before(async () => {
    await prisma.supportEntry.create({
      data: { partnerId: partnerA.id, amount: 500, effectiveDate: new Date("2026-01-01") },
    });
    await prisma.supportNeed.create({
      data: {
        partnerId: partnerA.id,
        description: "New laptop",
        requestedAmount: 800,
        requestDate: new Date("2026-01-01"),
      },
    });
    fileA = await prisma.partnerFile.create({
      data: {
        partnerId: partnerA.id,
        kind: "newsletter",
        receivedDate: new Date("2026-01-01"),
        fileName: "a.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture-a") } },
      },
    });
    fileB = await prisma.partnerFile.create({
      data: {
        partnerId: partnerB.id,
        kind: "newsletter",
        receivedDate: new Date("2026-01-01"),
        fileName: "b.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture-b") } },
      },
    });
  });

  after(async () => {
    await prisma.supportEntry.deleteMany({ where: { partnerId: partnerA.id } });
    await prisma.supportNeed.deleteMany({ where: { partnerId: partnerA.id } });
    await prisma.partnerFile.deleteMany({ where: { partnerId: { in: [partnerA.id, partnerB.id] } } });
  });

  test("403s Monthly Support for their own linked partner, not just a mismatched one", async () => {
    const leader = await leaderClient();
    const own = await leader(`/api/support-entries?partnerId=${partnerA.id}`);
    assert.equal(own.status, 403);
    const unfiltered = await leader("/api/support-entries");
    assert.equal(unfiltered.status, 403);
  });

  test("403s One-Time Needs for their own linked partner, not just a mismatched one", async () => {
    const leader = await leaderClient();
    const own = await leader(`/api/support-needs?partnerId=${partnerA.id}`);
    assert.equal(own.status, 403);
    const unfiltered = await leader("/api/support-needs");
    assert.equal(unfiltered.status, 403);
  });

  test("reads Newsletters & Docs for their own linked partner, in full", async () => {
    const leader = await leaderClient();
    const ok = await leader(`/api/partner-files?partnerId=${partnerA.id}`);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.some((f) => f.id === fileA.id));
    const blocked = await leader(`/api/partner-files?partnerId=${partnerB.id}`);
    assert.equal(blocked.status, 403);
  });

  test("downloads their own linked partner's file, 403s another partner's by id", async () => {
    const leader = await leaderClient();
    const ok = await leader(`/api/partner-files/${fileA.id}/download`);
    assert.equal(ok.status, 200);
    const blocked = await leader(`/api/partner-files/${fileB.id}/download`);
    assert.equal(blocked.status, 403);
  });
});

describe("Trip Leader: expiresAt revocation", () => {
  test("a past expiresAt is unauthorized, same as an inactive account", async () => {
    await prisma.user.update({
      where: { email: TRIP_LEADER_EMAIL },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    try {
      const leader = await leaderClient();
      const res = await leader(`/api/trips/${tripA.id}`);
      assert.equal(res.status, 401);
    } finally {
      await prisma.user.update({ where: { email: TRIP_LEADER_EMAIL }, data: { expiresAt: null } });
    }
  });
});

describe("users.js: Trip Leader account validation", () => {
  test("rejects creating a tripLeader with no scopedTripId", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-tl-no-scope@example.test", role: "tripLeader", password: "Password123!" },
    });
    assert.equal(res.status, 400);
  });

  test("rejects creating a tripLeader scoped to a trip that doesn't exist", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-tl-bad-scope@example.test",
        role: "tripLeader",
        scopedTripId: "00000000-0000-0000-0000-000000000000",
        password: "Password123!",
      },
    });
    assert.equal(res.status, 400);
  });

  test("creates a valid tripLeader account with its scope stored", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-tl-good-scope@example.test",
        role: "tripLeader",
        scopedTripId: tripA.id,
        password: "Password123!",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.scopedTripId, tripA.id);
    await prisma.user.delete({ where: { id: res.body.id } });
  });

  test("changing role away from tripLeader clears the scope", async () => {
    const created = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-tl-switch-role@example.test",
        role: "tripLeader",
        scopedTripId: tripA.id,
        password: "Password123!",
      },
    });
    assert.equal(created.status, 201);
    const updated = await admin(`/api/users/${created.body.id}`, { method: "PUT", body: { role: "viewer" } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.scopedTripId, null);
    await prisma.user.delete({ where: { id: created.body.id } });
  });
});
