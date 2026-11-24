// Filtering by a partner's sending church, ours included: the options endpoint, the
// `sendingChurch` parameter on every list about partners or their records, and a
// report. "Ours" is the partner flag (`__ours__`); every other option is a church
// name, matched without regard to case.
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

const OURS = "__ours__";
let admin;
let viewer;
let originalSettings;
let ours; // sent by our church
let grace; // sent by "Grace Fellowship"
let graceTwin; // "grace fellowship" -- same church, different case
let nobody; // no sending church recorded
let archivedGrace; // archived: not counted in the options

const names = (rows) => rows.map((r) => r.displayName || r.partner?.displayName || r.name).sort();

describe("sending church filter", () => {
  before(async () => {
    await ensureTestUsers();
    originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const current = originalSettings?.enabledFeatures || {};
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: {
        churchName: "Filter Test Church",
        enabledFeatures: { ...current, trips: true, prayerRequests: true, oneTimeNeeds: true },
      },
      create: {
        id: "singleton",
        churchName: "Filter Test Church",
        enabledFeatures: { trips: true, prayerRequests: true, oneTimeNeeds: true },
      },
    });
    admin = await client("admin");
    viewer = await client("viewer");
    const make = async (label, extra = {}) => {
      const res = await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} ${label}`, ...extra },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body;
    };
    ours = await make("Ours", { sentByOurChurch: true });
    grace = await make("Grace", { sendingChurch: { name: "Grace Fellowship" } });
    graceTwin = await make("Grace twin", { sendingChurch: { name: "grace fellowship" } });
    nobody = await make("Nobody");
    archivedGrace = await make("Archived Grace", { sendingChurch: { name: "Archived Only Church" } });
    await prisma.partner.update({ where: { id: archivedGrace.id }, data: { archived: true } });

    // Something owned by each of the first two partners, so the record lists can be filtered.
    for (const p of [ours, grace]) {
      await admin("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId: p.id,
          category: "strategic",
          requestText: `pray for ${p.displayName}`,
          dateReceived: "2026-11-01",
        },
      });
      await admin("/api/support-needs", {
        method: "POST",
        body: {
          partnerId: p.id,
          description: `need ${p.displayName}`,
          requestedAmount: 50,
          requestDate: "2026-11-01",
        },
      });
      await admin("/api/trips", {
        method: "POST",
        body: { partnerId: p.id, name: `${FIXTURE_TAG} trip ${p.displayName}`, status: "planning" },
      });
    }
  });
  after(async () => {
    await prisma.trip.deleteMany({ where: { name: { contains: FIXTURE_TAG } } });
    await removeFixturePartners();
    if (originalSettings) {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: {
          churchName: originalSettings.churchName,
          enabledFeatures: originalSettings.enabledFeatures ?? {},
        },
      });
    }
    await removeTestUsers();
    await stopServer();
  });

  test("the options list ours first, then each other church once, with counts", async () => {
    const res = await admin("/api/partners/sending-churches");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const first = res.body[0];
    assert.equal(first.value, OURS);
    assert.match(first.label, /Filter Test Church/);
    assert.ok(first.count >= 1 && first.ours === true);
    const gracePart = res.body.filter((o) => o.value.toLowerCase() === "grace fellowship");
    assert.equal(gracePart.length, 1, "the two spellings are one church");
    assert.equal(gracePart[0].count, 2);
    assert.ok(
      !res.body.some((o) => o.value === "Archived Only Church"),
      "an archived partner's church is not offered"
    );
  });

  test("a viewer can load the options; a guest cannot", async () => {
    assert.equal((await viewer("/api/partners/sending-churches")).status, 200);
    const anon = await client();
    assert.equal((await anon("/api/partners/sending-churches")).status, 401);
  });

  test("partners: ours, a church by name (any case), and no filter", async () => {
    const mine = (await admin(`/api/partners?sendingChurch=${OURS}`)).body.filter((p) =>
      p.displayName.includes(FIXTURE_TAG)
    );
    assert.deepEqual(names(mine), [`${FIXTURE_TAG} Ours`]);
    const g = (await admin("/api/partners?sendingChurch=GRACE%20FELLOWSHIP")).body.filter((p) =>
      p.displayName.includes(FIXTURE_TAG)
    );
    assert.deepEqual(names(g), [`${FIXTURE_TAG} Grace`, `${FIXTURE_TAG} Grace twin`]);
    const all = (await admin("/api/partners?sendingChurch=all")).body.filter((p) =>
      p.displayName.includes(FIXTURE_TAG)
    );
    assert.ok(all.length >= 4, "all means no filter");
  });

  test("prayer requests, needs and trips follow the partner's sending church", async () => {
    const prayers = (await admin(`/api/prayer-requests?sendingChurch=${OURS}`)).body;
    assert.ok(
      prayers.length >= 1 &&
        prayers.every(
          (r) => r.partner?.id === ours.id || !String(r.partner?.displayName).includes(FIXTURE_TAG)
        )
    );
    const gracePrayers = (await admin("/api/prayer-requests?sendingChurch=Grace%20Fellowship")).body.filter(
      (r) => String(r.partner?.displayName).includes(FIXTURE_TAG)
    );
    assert.deepEqual(names(gracePrayers), [`${FIXTURE_TAG} Grace`]);

    const needs = (await admin("/api/support-needs?sendingChurch=Grace%20Fellowship")).body.filter((r) =>
      String(r.partner?.displayName).includes(FIXTURE_TAG)
    );
    assert.deepEqual(names(needs), [`${FIXTURE_TAG} Grace`]);

    const trips = (await admin(`/api/trips?sendingChurch=${OURS}`)).body.filter((t) =>
      String(t.name).includes(FIXTURE_TAG)
    );
    assert.deepEqual(
      trips.map((t) => t.name),
      [`${FIXTURE_TAG} trip ${FIXTURE_TAG} Ours`]
    );
  });

  test("a report takes the same filter, and advertises the field", async () => {
    const meta = (await admin("/api/reports")).body.reports.find((r) => r.id === "data-completeness");
    const field = meta.fields.find((f) => f.name === "sendingChurch");
    assert.equal(field.dynamicOptions, "sendingChurches");
    const res = await admin(`/api/reports/data-completeness?sendingChurch=${OURS}`);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    const ours = res.body.rows.filter((r) => String(r.partnerName).includes(FIXTURE_TAG));
    assert.deepEqual(
      ours.map((r) => r.partnerName),
      [`${FIXTURE_TAG} Ours`]
    );
    const g = await admin("/api/reports/data-completeness?sendingChurch=Grace%20Fellowship");
    assert.deepEqual(
      g.body.rows
        .filter((r) => String(r.partnerName).includes(FIXTURE_TAG))
        .map((r) => r.partnerName)
        .sort(),
      [`${FIXTURE_TAG} Grace`, `${FIXTURE_TAG} Grace twin`]
    );
  });

  test("the trip reports take it too, through the trip's partner", async () => {
    const fundraising = await admin(`/api/reports/trip-fundraising?status=all&sendingChurch=${OURS}`);
    assert.equal(fundraising.status, 200, JSON.stringify(fundraising.body).slice(0, 200));
    const mine = fundraising.body.rows.filter((r) => String(r.trip).includes(FIXTURE_TAG));
    assert.deepEqual(
      mine.map((r) => r.trip),
      [`${FIXTURE_TAG} trip ${FIXTURE_TAG} Ours`]
    );
    // The funnel lists only trips that have applications; it must at least accept the filter
    // and never show another church's trip.
    const funnel = await admin("/api/reports/application-funnel?status=all&sendingChurch=Grace%20Fellowship");
    assert.equal(funnel.status, 200);
    assert.ok(!funnel.body.rows.some((r) => String(r.trip).includes(`${FIXTURE_TAG} Ours`)));
  });
});
