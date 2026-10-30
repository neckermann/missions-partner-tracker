const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
// Explicit rather than relying on ./helpers being required first --
// prismaClient reads DATABASE_URL at construction, so importing it before
// something has loaded .env fails with an opaque SASL error.
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

// The CSV starts with a UTF-8 BOM so Excel reads it as UTF-8 (see
// utils/csv.js). Stripped by code point rather than by a regex with an
// escape in it: writing that escape into this file keeps coming back as a
// literal BOM character, which is invisible in a diff and fails
// eslint's no-irregular-whitespace.
const BOM_CODE_POINT = 0xfeff;
function stripBom(text) {
  return text.charCodeAt(0) === BOM_CODE_POINT ? text.slice(1) : text;
}

// The Reports section is read-only, so the gate that matters here is the one
// it DOESN'T have: no role check. Any account that can sign in already reads
// every partner's full record (ADMIN_GUIDE.md § Who can see what), and roles
// govern writes. A viewer getting 200 below is the assertion that keeps
// someone from "tightening" this later and quietly contradicting that.

let admin;
let viewer;
let fixturePartnerId;

before(async () => {
  await ensureTestUsers();
  [admin, viewer] = await Promise.all([client("admin"), client("viewer")]);

  // A partner with a known birthday in a known month, so the report has
  // something deterministic to find.
  const partner = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Birthday Family`,
      adults: [{ name: "Adult Fixture", birthday: "1980-03-14" }],
      children: [{ name: "Child Fixture", birthday: "2015-03-02" }],
    },
  });
  fixturePartnerId = partner.body.id;

  // One fixture each for the three reports added alongside birthdays and
  // one-time-needs, all hung off the same fixture partner.
  await admin("/api/prayer-requests", {
    method: "POST",
    body: {
      partnerId: fixturePartnerId,
      category: "strategic",
      requestText: "Report fixture prayer request",
      dateReceived: "2026-03-01",
      status: "ongoing",
    },
  });
  await admin("/api/trips", {
    method: "POST",
    body: {
      partnerId: fixturePartnerId,
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      tripType: "Construction",
      description: "Report fixture trip",
      participants: [{ name: "Fixture Leader", isLeader: true }],
    },
  });
  await admin("/api/support-entries", {
    method: "POST",
    body: { partnerId: fixturePartnerId, amount: 500, effectiveDate: "2026-01-01" },
  });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/reports", () => {
  test("lists the registry with filter fields and columns", async () => {
    const res = await admin("/api/reports");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));

    const birthdays = res.body.find((r) => r.id === "upcoming-birthdays");
    assert.ok(birthdays, "upcoming-birthdays should be registered");
    assert.ok(birthdays.label);
    // The frontend builds its filter form from these; without them the page
    // renders a report nobody can parameterise.
    assert.ok(Array.isArray(birthdays.fields) && birthdays.fields.length);
    assert.ok(Array.isArray(birthdays.columns) && birthdays.columns.length);
  });

  test("requires a session", async () => {
    const res = await client().then((c) => c("/api/reports"));
    assert.equal(res.status, 401);
  });
});

describe("GET /api/reports/:id", () => {
  test("runs a report and returns rows with its own columns", async () => {
    const res = await admin("/api/reports/upcoming-birthdays?month=3");
    assert.equal(res.status, 200);
    assert.equal(res.body.id, "upcoming-birthdays");
    assert.ok(Array.isArray(res.body.columns));
    assert.ok(res.body.generatedAt, "the page prints this on the report");

    const names = res.body.rows.map((r) => r.name);
    assert.ok(names.includes("Adult Fixture"));
    assert.ok(names.includes("Child Fixture"));
  });

  test("returns the calendar day that was stored, not one either side of it", async () => {
    // The whole reason utils/birthdays.js uses UTC getters. A @db.Date comes
    // back as UTC midnight; read locally it is the previous day west of UTC.
    const res = await admin("/api/reports/upcoming-birthdays?month=3");
    const child = res.body.rows.find((r) => r.name === "Child Fixture");
    assert.equal(child.day, 2);
    assert.equal(child.personTypeLabel, "Child");
  });

  test("a viewer can run reports -- reads are not role-gated", async () => {
    const res = await viewer("/api/reports/upcoming-birthdays?month=3");
    assert.equal(
      res.status,
      200,
      "roles govern writes; gating this would contradict ADMIN_GUIDE.md § Who can see what"
    );
  });

  test("requires a session", async () => {
    const res = await client().then((c) => c("/api/reports/upcoming-birthdays?month=3"));
    assert.equal(res.status, 401);
  });

  test("an unknown report id 404s", async () => {
    const res = await admin("/api/reports/not-a-report");
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, "string");
  });

  test("invalid params 400 with a string error naming the field", async () => {
    // month 13 fails the report's own Zod schema; the central error
    // middleware guarantees `error` is a string, which every frontend call
    // site depends on (an array here used to blank the page).
    const res = await admin("/api/reports/upcoming-birthdays?month=13");
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string");
    assert.match(res.body.error, /month/i);
  });

  test("a missing required param 400s rather than running on a default", async () => {
    const res = await admin("/api/reports/upcoming-birthdays");
    assert.equal(res.status, 400);
  });
});

describe("prayer-requests report", () => {
  test("finds the fixture request, with a readable category and status", async () => {
    const res = await admin("/api/reports/prayer-requests?category=strategic");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.requestText === "Report fixture prayer request");
    assert.ok(row, "fixture prayer request should appear");
    assert.equal(row.category, "Strategic");
    assert.equal(row.status, "Ongoing");
    assert.equal(row.partnerName, `${FIXTURE_TAG} Birthday Family`);
  });

  test("an invalid category 400s", async () => {
    const res = await admin("/api/reports/prayer-requests?category=nonsense");
    assert.equal(res.status, 400);
  });
});

describe("trip-history report", () => {
  test("finds the fixture trip, with team size and leader derived from participants", async () => {
    const res = await admin("/api/reports/trip-history?year=2026");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.description === "Report fixture trip");
    assert.ok(row, "fixture trip should appear");
    assert.equal(row.partnerType, "Missionary");
    assert.equal(row.teamSize, 1);
    assert.equal(row.leaders, "Fixture Leader");
  });

  test("a year with nothing in it returns no rows, not an error", async () => {
    const res = await admin("/api/reports/trip-history?year=1901");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.rows, []);
  });
});

describe("monthly-support report", () => {
  test("shows the fixture partner's current amount", async () => {
    const res = await admin("/api/reports/monthly-support");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.partnerId === fixturePartnerId);
    assert.ok(row, "fixture partner should have a current support row");
    assert.equal(row.amount, 500);
  });

  test("a partner with no support entry doesn't appear", async () => {
    const bare = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} No Support` },
    });
    // No finally-block delete here: DELETE /api/partners/:id refuses an
    // unarchived partner (archive-then-delete is deliberate, a safety
    // step against one-click permanent removal), so a bare delete of a
    // freshly created partner always 400s. That failure is silent if you
    // don't check the response -- the partner leaks into the database on
    // every run instead of being cleaned up. removeFixturePartners() in
    // this file's own after() already deletes everything tagged
    // FIXTURE_TAG directly via Prisma, bypassing that route entirely, so
    // this fixture is already covered without fighting the route's rules.
    const res = await admin("/api/reports/monthly-support");
    assert.equal(
      res.body.rows.some((r) => r.partnerId === bare.body.id),
      false
    );
  });
});

describe("CSV export", () => {
  test("serves text/csv as an attachment with the report's columns as the header", async () => {
    const res = await admin("/api/reports/upcoming-birthdays?month=3&format=csv");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), /attachment; filename="upcoming-birthdays-/);

    // Written as an escape, not the character itself: a literal BOM in the
    // source is invisible in a diff and trips eslint's no-irregular-whitespace.
    const body = stripBom(res.body);
    const [header] = body.split("\r\n");
    assert.equal(header, "Day,Name,Adult/Child,Turning,Partner,Field");
    assert.match(body, /Child Fixture/);
  });

  test("the CSV carries the same rows as the JSON, not a different query", async () => {
    const [json, csv] = await Promise.all([
      admin("/api/reports/upcoming-birthdays?month=3"),
      admin("/api/reports/upcoming-birthdays?month=3&format=csv"),
    ]);
    const csvRows = csv.body.trim().split("\r\n").slice(1);
    assert.equal(csvRows.length, json.body.rows.length);
  });

  test("one-time-needs exports too, with its own header", async () => {
    const res = await admin("/api/reports/one-time-needs?format=csv");
    assert.equal(res.status, 200);
    const [header] = stripBom(res.body).split("\r\n");
    assert.equal(header, "Requested,Partner,Need,Requested ($),Approved ($),Decided,Status");
  });
});

describe("feature gate", () => {
  let original;

  before(async () => {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    original = settings?.enabledFeatures ?? {};
  });

  after(async () => {
    // Settings are one global row -- restore it or every later suite runs
    // against whatever this left behind. test:routes is --test-concurrency=1
    // so nothing reads it mid-flight.
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { enabledFeatures: original },
      create: { id: "singleton", enabledFeatures: original },
    });
  });

  test("turning Reports off 404s the routes, not just the nav link", async () => {
    // upsert, not update: the seed deliberately does not create this row
    // (see the comment in prisma/seed.js) -- it appears the first time an
    // admin saves settings. Using update here makes the suite depend on
    // some earlier suite having created it, which is an ordering landmine
    // rather than a test.
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { enabledFeatures: { ...original, reports: false } },
      create: { id: "singleton", enabledFeatures: { ...original, reports: false } },
    });

    const [list, run] = await Promise.all([
      admin("/api/reports"),
      admin("/api/reports/upcoming-birthdays?month=3"),
    ]);
    assert.equal(list.status, 404);
    assert.equal(run.status, 404);
  });

  // The four reports that mirror a resource with its own toggle --
  // everything except upcoming-birthdays, which has no such resource.
  // Turning that resource's feature off should also 404 its report and
  // drop it from the picker, the same way disabling Reports itself does --
  // a church that turned off Prayer Requests shouldn't still find it
  // listed as something to export.
  const resourceReports = [
    { reportId: "one-time-needs", feature: "oneTimeNeeds" },
    { reportId: "prayer-requests", feature: "prayerRequests" },
    { reportId: "trip-history", feature: "trips" },
    { reportId: "monthly-support", feature: "monthlySupport" },
  ];

  for (const { reportId, feature } of resourceReports) {
    test(`turning off ${feature} 404s the ${reportId} report and drops it from the picker`, async () => {
      await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        update: { enabledFeatures: { ...original, [feature]: false } },
        create: { id: "singleton", enabledFeatures: { ...original, [feature]: false } },
      });

      const [list, run] = await Promise.all([admin("/api/reports"), admin(`/api/reports/${reportId}`)]);
      assert.equal(run.status, 404);
      assert.equal(
        list.body.some((r) => r.id === reportId),
        false
      );
    });
  }
});
