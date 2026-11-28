// The reporting system's real queries: every report's actual query against a real Postgres,
// not just the unit-level compute logic (see
// reportingDefinitions.test.js/reportingReports.test.js).
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
    careTeam: true, // the care-team-coverage report only exists while this is on
    supportPreferences: true, // likewise the support-preferences report
    surveys: true, // and the survey-responses report
    groupme: true, // and update sending health, which needs a channel on
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
    assert.equal(ids.length, 19, "every report in the registry is listed for an admin");
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
  // Each report's real Prisma query, not just its compute logic against hand-built fixtures.
  // This doesn't assert every report's numbers; it asserts the query is valid and returns the
  // documented shape against a mostly-empty database, the condition a freshly-deployed fork is
  // in.
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

  test("last-heard-from leaves out the columns of a feature that is off, and does not claim nobody sent a newsletter", async () => {
    await createPartner({ displayName: `${FIXTURE_TAG} No Newsletter Partner` });
    try {
      const keys = (body) => body.columns.map((c) => c.key);
      const labels = (body) => body.summary.map((x) => x.label);

      await setFeatures({ partnerFiles: true, contactLog: true, prayerRequests: true });
      const on = (await admin("/api/reports/last-heard-from?onlyStale=false")).body;
      assert.ok(["newsletter", "contact", "prayer"].every((k) => keys(on).includes(k)));
      assert.ok(labels(on).includes("Never sent a newsletter"));

      await setFeatures({ partnerFiles: false, contactLog: false, prayerRequests: false });
      const off = (await admin("/api/reports/last-heard-from?onlyStale=false")).body;
      for (const k of ["newsletter", "newsletterDays", "contact", "contactDays", "prayer"]) {
        assert.ok(!keys(off).includes(k), `${k} is left out`);
      }
      assert.ok(!labels(off).includes("Never sent a newsletter"));
      assert.ok(keys(off).includes("visit"), "what still applies stays");
      assert.match(off.notes.join(" "), /a church visit/);
      assert.doesNotMatch(off.notes.join(" "), /newsletter|prayer request|logged contact/);
    } finally {
      await setFeatures({ partnerFiles: true, contactLog: true, prayerRequests: true });
    }
  });

  test("update sending health is in the catalog only while a channel is switched on", async () => {
    const listed = async () => {
      const res = await admin("/api/reports");
      assert.equal(res.status, 200);
      return JSON.stringify(res.body).includes("dispatch-health");
    };
    try {
      await setFeatures({ groupme: false, whatsapp: false, outboundEmail: false });
      assert.equal(await listed(), false);
      assert.equal((await admin("/api/reports/dispatch-health")).status, 404);
      await setFeatures({ groupme: true });
      assert.equal(await listed(), true);
      assert.equal((await admin("/api/reports/dispatch-health")).status, 200);
    } finally {
      await setFeatures({ groupme: true, whatsapp: false, outboundEmail: false });
    }
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

  // Nothing in DEFAULT_ROLES (registry.js) includes "tripLeader", and the route's
  // requireRole("admin", "editor", "viewer") rejects it with a 403 before the registry is
  // consulted, like every other role-gated route.
  // Monthly support amounts must not show anywhere once that feature is switched off: not in a report that stays
  // available, not in its CSV, and not in the partner list the admin pages load.
  describe("monthly support amounts while Monthly support is off", () => {
    const AMOUNT = 4321;
    const COUNTRY = "Supportoffland";
    let partner;

    before(async () => {
      partner = await createPartner({
        displayName: `${FIXTURE_TAG} Support Off Partner`,
        // A country no seeded partner is in, so its "Where we serve" row is this partner's amount alone.
        addresses: { create: { type: "physical", country: COUNTRY } },
      });
      await prisma.supportEntry.create({
        data: { partnerId: partner.id, amount: AMOUNT, effectiveDate: new Date("2020-01-01") },
      });
    });

    after(async () => {
      await setFeatures({ monthlySupport: true });
    });

    const hasAmount = (body) => JSON.stringify(body).includes(String(AMOUNT));

    test("with the feature on, the amounts are there (so the off case is a real difference)", async () => {
      await setFeatures({ monthlySupport: true });
      for (const id of ["where-we-serve", "partner-roster"]) {
        const res = await admin(`/api/reports/${id}`);
        assert.equal(res.status, 200);
        assert.ok(
          res.body.columns.some((c) => c.key === "monthly"),
          `${id} has the Committed column`
        );
        assert.ok(hasAmount(res.body.rows), `${id} carries the amount`);
      }
      const list = await admin("/api/partners");
      assert.equal(list.body.find((p) => p.id === partner.id).supportEntries[0].amount, AMOUNT);
    });

    test("'Where we serve' and 'Partner roster' leave out every amount, for each role, on screen and in the CSV", async () => {
      await setFeatures({ monthlySupport: false });
      for (const as of [admin, editor, viewer]) {
        for (const id of ["where-we-serve", "partner-roster"]) {
          const res = await as(`/api/reports/${id}`);
          assert.equal(res.status, 200, `${id} is still available`);
          const keys = res.body.columns.map((c) => c.key);
          assert.ok(!keys.includes("monthly") && !keys.includes("share"), `${id}: no support columns`);
          assert.ok(
            res.body.rows.every((r) => !("monthly" in r) && !("share" in r)),
            `${id}: no support values in the rows`
          );
          assert.ok(!hasAmount(res.body), `${id}: the amount appears nowhere in the response`);
          assert.ok(
            !res.body.summary.some((line) => /committed/i.test(line.label)),
            `${id}: no "Committed per month" summary`
          );
          assert.equal(res.body.chart, null, `${id}: no support chart`);

          const csv = await as(`/api/reports/${id}?format=csv`);
          assert.equal(csv.status, 200);
          assert.doesNotMatch(String(csv.body), /Committed|Share of support/);
          assert.ok(!String(csv.body).includes(String(AMOUNT)));
        }
      }
      const row = (await admin("/api/reports/where-we-serve")).body.rows.find((r) => r.country === COUNTRY);
      assert.equal(row?.partners, 1, "the countries and partner counts are still reported");
    });

    test("the catalog drops the support columns and no longer asks 'how much support goes where?'", async () => {
      await setFeatures({ monthlySupport: false });
      const res = await admin("/api/reports");
      const where = res.body.reports.find((r) => r.id === "where-we-serve");
      const roster = res.body.reports.find((r) => r.id === "partner-roster");
      assert.ok(!where.columns.some((c) => c.key === "monthly" || c.key === "share"));
      assert.ok(!roster.columns.some((c) => c.key === "monthly"));
      assert.doesNotMatch(where.question, /support/i);
      assert.ok(!res.body.reports.some((r) => r.id === "support-summary" || r.id === "support-changes"));
    });

    test("no other report that stays available shows a support amount", async () => {
      await setFeatures({ monthlySupport: false });
      const catalog = await admin("/api/reports");
      for (const report of catalog.body.reports) {
        const res = await admin(`/api/reports/${report.id}`);
        assert.equal(res.status, 200, `${report.id} runs`);
        const mine = res.body.rows.filter((r) => String(r.partnerName || "").includes("Support Off Partner"));
        assert.ok(!hasAmount(mine), `${report.id} does not carry the partner's support amount`);
        assert.ok(
          !res.body.columns.some((c) => /committed|monthly support/i.test(c.label)),
          `${report.id} has no support column`
        );
      }
    });

    test("GET /api/partners does not return supportEntries to an admin, editor or viewer", async () => {
      await setFeatures({ monthlySupport: false });
      for (const as of [admin, editor, viewer]) {
        const res = await as("/api/partners");
        assert.equal(res.status, 200);
        const row = res.body.find((p) => p.id === partner.id);
        assert.ok(row, "the partner is still listed");
        assert.equal(row.supportEntries, undefined);
        assert.ok(!hasAmount(row));
        assert.ok(res.body.every((p) => !("supportEntries" in p)));
      }
    });
  });

  test("a viewer can still reach a trips report (not admin-only)", async () => {
    const res = await viewer("/api/reports/trip-fundraising");
    assert.equal(res.status, 200);
  });
});
