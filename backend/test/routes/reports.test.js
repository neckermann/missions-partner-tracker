// New reporting system (#296/#297) -- rebuilt from scratch, replacing the
// old per-report routes/tests this file used to cover. The PR that built
// this flagged its own queries as unverified ("no Prisma client in the
// cloud workspace, so the database queries have not been run") -- this is
// that verification: every report's actual query against a real Postgres,
// not just the unit-level compute logic (see reportingDefinitions.test.js/
// reportingReports.test.js for that).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, FIXTURE_TAG } = require("./helpers");
const { listReports } = require("../../src/reporting/registry");

let admin;
let editor;
let viewer;
let originalEnabledFeatures;

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

function createPartner(overrides) {
  return prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Partner`, isPublic: false, ...overrides },
  });
}

async function removeFixtureData() {
  await prisma.prayerRequest.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
  await prisma.supportNeed.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
  await prisma.supportEntry.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
  await prisma.trip.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
}

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer] = await Promise.all([client("admin"), client("editor"), client("viewer")]);
  await removeFixtureData();

  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({
    reports: true,
    prayerRequests: true,
    oneTimeNeeds: true,
    monthlySupport: true,
    trips: true,
  });
});

after(async () => {
  await removeFixtureData();
  await setFeatures(originalEnabledFeatures);
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/reports (catalog)", () => {
  test("an admin sees every report, including the admin-only one", async () => {
    const res = await admin("/api/reports");
    assert.equal(res.status, 200);
    const ids = res.body.reports.map((r) => r.id);
    assert.ok(ids.includes("users-access"), "admin sees the admin-only report");
    assert.equal(ids.length, 16, "every report in the registry is listed for an admin");
  });

  test("a viewer does not see the admin-only report", async () => {
    const res = await viewer("/api/reports");
    assert.equal(res.status, 200);
    const ids = res.body.reports.map((r) => r.id);
    assert.ok(!ids.includes("users-access"), "a viewer never sees the admin-only report");
  });

  test("the feature gate hides reports behind an off feature, not just the top-level toggle", async () => {
    await setFeatures({ monthlySupport: false });
    try {
      const res = await admin("/api/reports");
      const ids = res.body.reports.map((r) => r.id);
      assert.ok(!ids.includes("support-summary"), "support-summary needs monthlySupport on");
      assert.ok(!ids.includes("support-changes"), "support-changes needs monthlySupport on");
    } finally {
      await setFeatures({ monthlySupport: true });
    }
  });
});

describe("GET /api/reports/:id -- every report runs against real data without crashing", () => {
  // The core thing this PR's own description flagged as unverified: each
  // report's real Prisma query, not just its compute logic against
  // hand-built fixtures (that's reportingReports.test.js's job). This
  // doesn't assert every report's specific numbers -- it asserts the
  // query itself is valid and returns the documented shape against a
  // real, mostly-empty-of-that-domain database, which is exactly the
  // condition a freshly-deployed fork is in.
  for (const { id } of listReports({ role: "admin", isEnabled: () => true }).reports) {
    test(`${id} returns 200 with the documented shape`, async () => {
      const res = await admin(`/api/reports/${id}`);
      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.id, id);
      assert.ok(Array.isArray(res.body.rows), "rows is an array");
      assert.ok(Array.isArray(res.body.columns), "columns is an array");
      assert.ok(Array.isArray(res.body.summary), "summary is an array");
    });
  }
});

describe("GET /api/reports/:id with real seeded data", () => {
  test("prayer-requests reflects a real open request for a real partner", async () => {
    const partner = await createPartner({ displayName: `${FIXTURE_TAG} Prayer Partner` });
    await prisma.prayerRequest.create({
      data: {
        partnerId: partner.id,
        category: "situational",
        requestText: "Safe travel for the field visit",
        dateReceived: new Date(),
        // status defaults to "ongoing", which is what the report's own
        // default status=open filter (prayerState's "open" bucket) shows.
      },
    });

    const res = await admin("/api/reports/prayer-requests");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.partnerName === partner.displayName);
    assert.ok(row, "the seeded request shows up in the report");
  });

  test("support-summary reflects a real monthly support entry", async () => {
    const partner = await createPartner({ displayName: `${FIXTURE_TAG} Support Partner` });
    await prisma.supportEntry.create({
      data: { partnerId: partner.id, amount: 250, effectiveDate: new Date("2026-01-01") },
    });

    const res = await admin("/api/reports/support-summary");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.partnerName === partner.displayName);
    assert.ok(row, "the seeded support entry shows up in the report");
    assert.equal(row.monthly, 250);
  });

  test("last-heard-from reflects a real lastPrayedWithCongregationAt value, and null when unset", async () => {
    const prayedFor = await createPartner({
      displayName: `${FIXTURE_TAG} Prayed-For Partner`,
      lastPrayedWithCongregationAt: new Date("2026-10-01"),
    });
    const neverPrayedFor = await createPartner({
      displayName: `${FIXTURE_TAG} Never-Prayed-For Partner`,
    });

    const res = await admin("/api/reports/last-heard-from?onlyStale=false");
    assert.equal(res.status, 200);
    const prayedRow = res.body.rows.find((r) => r.partnerName === prayedFor.displayName);
    const neverRow = res.body.rows.find((r) => r.partnerName === neverPrayedFor.displayName);
    assert.ok(prayedRow, "the seeded partner with the field set shows up");
    assert.equal(prayedRow.lastPrayedWithCongregation, "2026-10-01");
    assert.ok(neverRow, "the seeded partner without the field shows up");
    assert.equal(neverRow.lastPrayedWithCongregation, null);
  });

  test("format=csv returns an actual CSV body, not the JSON shape", async () => {
    const res = await admin("/api/reports/prayer-requests?format=csv");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/csv/);
    assert.equal(typeof res.body, "string", "CSV isn't valid JSON, so the helper leaves it as raw text");
    assert.ok(res.body.includes(","), "looks like CSV");
  });
});

describe("Role and feature gating", () => {
  test("users-access is 404 for a non-admin -- same as not existing", async () => {
    const res = await editor("/api/reports/users-access");
    assert.equal(res.status, 404);
  });

  test("the whole reports surface 404s when the feature is off", async () => {
    await setFeatures({ reports: false });
    try {
      const res = await admin("/api/reports");
      assert.equal(res.status, 404);
    } finally {
      await setFeatures({ reports: true });
    }
  });

  // Nothing in DEFAULT_ROLES (registry.js) includes "tripLeader", so no
  // report is ever reachable for that role -- but the route's own
  // requireRole("admin", "editor", "viewer") already rejects a tripLeader
  // with a 403 before the registry is even consulted, same as every other
  // role-gated route in this app. Nothing new to verify at the route
  // level beyond that existing, already-tested middleware.
  test("a viewer can still reach a trips report (not admin-only)", async () => {
    const res = await viewer("/api/reports/trip-fundraising");
    assert.equal(res.status, 200);
  });
});
