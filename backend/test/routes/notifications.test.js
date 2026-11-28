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
let partnerId;
let adminUserId;
let realFeatures;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  // The bell lists a category only while the feature behind its page is on, so turn those on here.
  realFeatures = (
    await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } })
  )?.enabledFeatures;
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: {
        ...(realFeatures || {}),
        groupme: true,
        whatsapp: true,
        inboundEmail: true,
        surveys: true,
        prayerRequests: true,
        oneTimeNeeds: true,
        trips: true,
      },
    },
    create: { id: "singleton", enabledFeatures: { groupme: true } },
  });

  const me = await admin("/api/auth/me");
  adminUserId = me.body.id;

  await removeFixturePartners();
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} notifications target`, isRestricted: true },
  });
  partnerId = partner.body.id;
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: realFeatures ?? {} },
  });
  await prisma.notificationSeen.deleteMany({ where: { userId: adminUserId } });
  await prisma.dispatchRecord.deleteMany({ where: { partnerId } });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/notifications/summary", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/notifications/summary")).status, 401);
  });

  test("admin sees admin-only categories; editor and viewer do not", async () => {
    const adminRes = await admin("/api/notifications/summary");
    assert.equal(adminRes.status, 200);
    const adminKeys = adminRes.body.categories.map((c) => c.key);
    assert.ok(adminKeys.includes("adminMfaDisabled"));
    assert.ok(adminKeys.includes("dispatchSendFailures"));
    assert.ok(adminKeys.includes("whatsappConnectionDrop"));

    const editorRes = await editor("/api/notifications/summary");
    const editorKeys = editorRes.body.categories.map((c) => c.key);
    assert.ok(!editorKeys.includes("adminMfaDisabled"));
    assert.ok(!editorKeys.includes("dispatchSendFailures"));

    const viewerRes = await viewer("/api/notifications/summary");
    const viewerKeys = viewerRes.body.categories.map((c) => c.key);
    assert.ok(!viewerKeys.includes("adminMfaDisabled"));

    // Every role still sees the shared, all-visibility categories.
    assert.ok(adminKeys.includes("dispatchesNeedingApproval"));
    assert.ok(editorKeys.includes("dispatchesNeedingApproval"));
    assert.ok(viewerKeys.includes("dispatchesNeedingApproval"));
  });

  test("dispatchesNeedingApproval counts only restricted, unreviewed rows -- not the whole pending queue", async () => {
    const ordinary = await prisma.dispatchRecord.create({
      data: { type: "newsletterCreated", partnerId, payload: {} },
    });
    const before1 = await admin("/api/notifications/summary");
    const ordinaryCat = before1.body.categories.find((c) => c.key === "dispatchesNeedingApproval");
    assert.equal(ordinaryCat.count, 0, "an ordinary (non-restricted) pending dispatch must not count here");

    const held = await prisma.dispatchRecord.create({
      data: { type: "prayerRequestCreated", partnerId, payload: { requestText: "test" } },
    });
    const after1 = await admin("/api/notifications/summary");
    const heldCat = after1.body.categories.find((c) => c.key === "dispatchesNeedingApproval");
    assert.equal(heldCat.count, 1);
    assert.equal(heldCat.isNew, true);

    await prisma.dispatchRecord.deleteMany({ where: { id: { in: [ordinary.id, held.id] } } });
  });

  test("marking a category seen clears isNew for that category only, for the user who marked it", async () => {
    const row = await prisma.dispatchRecord.create({
      data: { type: "prayerRequestCreated", partnerId, payload: { requestText: "test 2" } },
    });

    const seenCheck = await admin("/api/notifications/summary");
    assert.equal(seenCheck.body.categories.find((c) => c.key === "dispatchesNeedingApproval").isNew, true);

    const markRes = await admin("/api/notifications/seen", {
      method: "POST",
      body: { category: "dispatchesNeedingApproval" },
    });
    assert.equal(markRes.status, 204);

    const afterSeen = await admin("/api/notifications/summary");
    const cat = afterSeen.body.categories.find((c) => c.key === "dispatchesNeedingApproval");
    assert.equal(cat.count, 1, "the count itself stays -- it's still genuinely unresolved");
    assert.equal(cat.isNew, false, "but the per-user 'new' highlight clears once this user has looked");

    // A different user who hasn't looked still sees it as new -- per-user,
    // not shared (see categories.js's own header comment).
    const editorView = await editor("/api/notifications/summary");
    assert.equal(editorView.body.categories.find((c) => c.key === "dispatchesNeedingApproval").isNew, true);

    await prisma.dispatchRecord.delete({ where: { id: row.id } });
  });

  test("newPrayerRequests is a per-user count, not a shared one", async () => {
    await prisma.notificationSeen.deleteMany({ where: { category: "newPrayerRequests" } });
    const pr = await prisma.prayerRequest.create({
      data: {
        partnerId,
        category: "situational",
        requestText: `${FIXTURE_TAG} new request`,
        dateReceived: new Date(),
      },
    });

    const res = await admin("/api/notifications/summary");
    const cat = res.body.categories.find((c) => c.key === "newPrayerRequests");
    assert.ok(cat.count >= 1);
    assert.equal(cat.isNew, true);

    await admin("/api/notifications/seen", { method: "POST", body: { category: "newPrayerRequests" } });
    const afterSeen = await admin("/api/notifications/summary");
    const afterCat = afterSeen.body.categories.find((c) => c.key === "newPrayerRequests");
    assert.equal(afterCat.count, 0, "nothing newer than this admin's own seenAt remains");

    await prisma.prayerRequest.delete({ where: { id: pr.id } });
  });
});

// A bell item must never lead to a page that says "This feature is turned off": a category is hidden
// while the feature behind its page is off, whatever rows are still on file.
describe("bell items for switched-off pages", () => {
  let original;
  before(async () => {
    original = (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures;
  });
  after(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: original ?? {} },
    });
  });

  async function keys() {
    const res = await admin("/api/notifications/summary");
    return res.body.categories.map((c) => c.key);
  }
  async function setFeatures(patch) {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...(original || {}), ...patch } },
    });
  }

  test("Unmatched Emails and email failures need Email (Receiving)", async () => {
    await setFeatures({ inboundEmail: false });
    let k = await keys();
    assert.ok(!k.includes("unmatchedEmails") && !k.includes("inboundEmailFailures"));
    await setFeatures({ inboundEmail: true });
    k = await keys();
    assert.ok(k.includes("unmatchedEmails") && k.includes("inboundEmailFailures"));
  });

  test("Pending Dispatches items need GroupMe, WhatsApp or Email (Sending)", async () => {
    await setFeatures({ groupme: false, whatsapp: false, outboundEmail: false });
    let k = await keys();
    assert.ok(!k.includes("dispatchesNeedingApproval") && !k.includes("dispatchSendFailures"));
    await setFeatures({ groupme: true });
    k = await keys();
    assert.ok(k.includes("dispatchesNeedingApproval") && k.includes("dispatchSendFailures"));
  });

  test("the WhatsApp, prayer-request, need and trip items follow their own features", async () => {
    await setFeatures({ whatsapp: false, prayerRequests: false, oneTimeNeeds: false, trips: false });
    let k = await keys();
    for (const key of [
      "whatsappConnectionDrop",
      "newPrayerRequests",
      "newOneTimeNeeds",
      "tripApplicationsPending",
    ]) {
      assert.ok(!k.includes(key), `${key} is hidden while its page is off`);
    }
    await setFeatures({ whatsapp: true, prayerRequests: true, oneTimeNeeds: true, trips: true });
    k = await keys();
    for (const key of [
      "whatsappConnectionDrop",
      "newPrayerRequests",
      "newOneTimeNeeds",
      "tripApplicationsPending",
    ]) {
      assert.ok(k.includes(key), `${key} shows once its page is on`);
    }
  });
});

// One trip alert, not two: "Trips departing soon" says how many of the trips still have something missing.
describe("trips departing soon: one alert", () => {
  const created = [];
  let original;
  // Any other trip on this shared database that starts within the window is set aside (marked completed) for the
  // length of these tests and put back after, so "exactly one trip is departing soon" is a fact of the test, not
  // of whatever other files left behind.
  let setAside = [];
  before(async () => {
    original = (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures;
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...(original || {}), trips: true } },
    });
    // Other fixtures in this database may already have a trip starting soon; start from a clean slate.
    await prisma.trip.deleteMany({ where: { name: { contains: FIXTURE_TAG } } });
    const now = new Date();
    setAside = await prisma.trip.findMany({
      where: {
        status: { not: "completed" },
        startDate: { gt: now, lte: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, status: true },
    });
    for (const trip of setAside) {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: "completed" } });
    }
  });
  after(async () => {
    await prisma.trip.deleteMany({ where: { id: { in: created } } });
    for (const trip of setAside) {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: trip.status } });
    }
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: original ?? {} },
    });
  });

  const soon = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  async function makeTrip(label, { missing }) {
    const trip = await prisma.trip.create({
      data: { name: `${FIXTURE_TAG} ${label}`, status: "planning", startDate: soon(), endDate: soon() },
    });
    created.push(trip.id);
    if (missing) {
      await prisma.tripParticipant.create({ data: { tripId: trip.id, firstName: "A", lastName: "B" } });
      await prisma.tripRequirement.create({
        data: { tripId: trip.id, label: "Passport copy", kind: "document" },
      });
    }
    return trip;
  }
  const alertOf = async () => (await admin("/api/notifications/summary")).body.categories;

  test("there is no separate 'incomplete' alert any more", async () => {
    const keys = (await alertOf()).map((c) => c.key);
    assert.ok(!keys.includes("tripsDepartingSoonIncomplete"));
    assert.ok(keys.includes("tripsDepartingSoon"));
  });

  // Other files share this database, so each test reads the alert before and after adding its own trip and checks
  // what changed, instead of assuming nothing else is departing soon.
  const departingSoon = async () => (await alertOf()).find((c) => c.key === "tripsDepartingSoon");
  const missingIn = (item) => Number(item?.label?.match(/\((\d+) missing something\)/)?.[1] ?? 0);

  test("a trip with everything in order counts, with the plain label", async () => {
    const before = await departingSoon();
    const trip = await makeTrip("all fine", { missing: false });
    try {
      const item = await departingSoon();
      assert.equal(item.count, (before?.count ?? 0) + 1, "this trip is counted");
      assert.equal(missingIn(item), missingIn(before), "and says nothing is missing for it");
      if (!before || before.count === 0) assert.equal(item.label, "Trips departing soon");
    } finally {
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });

  test("a trip with something missing says so, and links to its requirements", async () => {
    const before = await departingSoon();
    const trip = await makeTrip("missing a passport", { missing: true });
    try {
      const item = await departingSoon();
      assert.equal(item.count, (before?.count ?? 0) + 1, "this trip is counted");
      assert.equal(missingIn(item), missingIn(before) + 1, "and one more is missing something");
      assert.match(item.label, /^Trips departing soon \(\d+ missing something\)$/);
      // The link goes straight to the requirements only when this is the only trip departing soon; with others
      // (left by another test file) it goes to the list, so that is the one case that can be asserted.
      if (!before || before.count === 0) assert.equal(item.linkTo, `/admin/trips/${trip.id}/requirements`);
    } finally {
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });
});
