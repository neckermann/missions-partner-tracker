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
