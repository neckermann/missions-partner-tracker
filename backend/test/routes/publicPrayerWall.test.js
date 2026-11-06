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
let anon;

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

async function createPartner(overrides) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Prayer Wall Partner`,
      isPublic: true,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function createPrayerRequest(partnerId, requestText) {
  const res = await admin("/api/prayer-requests", {
    method: "POST",
    body: { partnerId, category: "situational", requestText, dateReceived: "2026-01-01" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
  // Fully on. Individual tests narrow this to check the gating itself.
  await setFeatures({ publicPrayerDigest: true, publicDirectory: true });
});

after(async () => {
  await removeFixturePartners();
  await setFeatures({ publicPrayerDigest: false });
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/public/prayer-wall -- feature gating", () => {
  test("404s when publicPrayerDigest is off, even with publicDirectory on", async () => {
    await setFeatures({ publicPrayerDigest: false, publicDirectory: true });
    try {
      assert.equal((await anon("/api/public/prayer-wall")).status, 404);
    } finally {
      await setFeatures({ publicPrayerDigest: true });
    }
  });

  test("404s when publicDirectory is off, even with publicPrayerDigest on -- requireFeature's array form wouldn't catch this, both are required by hand", async () => {
    await setFeatures({ publicDirectory: false, publicPrayerDigest: true });
    try {
      assert.equal((await anon("/api/public/prayer-wall")).status, 404);
    } finally {
      await setFeatures({ publicDirectory: true });
    }
  });

  test("200s when both are on", async () => {
    assert.equal((await anon("/api/public/prayer-wall")).status, 200);
  });
});

describe("GET /api/public/prayer-wall -- eligibility and masking", () => {
  test("a prayerRequestCreated row on a public partner appears", async () => {
    const p = await createPartner({});
    const requestText = `${FIXTURE_TAG} wall visible request`;
    await createPrayerRequest(p.id, requestText);

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    assert.ok(res.body.some((item) => item.bodyText === requestText));
  });

  test("a non-public partner's prayer request never appears", async () => {
    const p = await createPartner({ isPublic: false });
    const requestText = `${FIXTURE_TAG} private partner, never on wall`;
    await createPrayerRequest(p.id, requestText);

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    assert.ok(!res.body.some((item) => item.bodyText === requestText));
  });

  test("a supportNeedCreated row never appears, even on a public partner -- type-level filter, not isPublic/category", async () => {
    const p = await createPartner({});
    const description = `${FIXTURE_TAG} wall should never show this need`;
    const needRes = await admin("/api/support-needs", {
      method: "POST",
      body: { partnerId: p.id, description, requestedAmount: 50, requestDate: "2026-01-01" },
    });
    assert.equal(needRes.status, 201, JSON.stringify(needRes.body));

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    assert.ok(!res.body.some((item) => item.bodyText === description));
  });

  test("a restricted public partner's request is masked (initials, no source link) once reviewed", async () => {
    const p = await createPartner({ displayName: `${FIXTURE_TAG} Jordan Rivera`, isRestricted: true });
    const requestText = `${FIXTURE_TAG} restricted wall request`;
    await createPrayerRequest(p.id, requestText);
    const row = await prisma.pendingNotification.findFirst({
      where: { partnerId: p.id, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row);
    // #187's review gate applies here exactly as it does for every other
    // channel -- a restricted partner's real-content row doesn't appear
    // on the public wall until an admin has reviewed/confirmed it.
    const editedText = "Pray for safety during an upcoming trip.";
    const putRes = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    const item = res.body.find((i) => i.partnerId === p.id);
    assert.ok(item, "a restricted partner's reviewed request should appear, masked");
    assert.ok(
      !item.partnerName.includes("Jordan") && !item.partnerName.includes("Rivera"),
      `real name must not leak: ${item.partnerName}`
    );
    assert.equal(item.bodyText, editedText);
    assert.equal(item.sourceLinkUrl, undefined, "no source link field at all for this audience");
    assert.equal(item.sourceFileId, undefined, "no source file id field at all for this audience");
    assert.equal(item.groupmeText, undefined, "no groupme-specific text field for this audience");
  });

  test("a restricted partner's held (unreviewed) real-content row never appears on the wall", async () => {
    const p = await createPartner({ displayName: `${FIXTURE_TAG} Held Partner`, isRestricted: true });
    const requestText = `${FIXTURE_TAG} held row, must not appear`;
    await createPrayerRequest(p.id, requestText);
    const row = await prisma.pendingNotification.findFirst({
      where: { partnerId: p.id, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row, "fixture setup: row should be queued");
    assert.equal(row.reviewedAt, null, "fixture setup: row should be unreviewed");

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    assert.ok(
      !res.body.some((item) => item.partnerId === p.id),
      "a held row must not leak onto the public wall before an admin reviews it"
    );
  });

  test("once reviewed, a restricted partner's request appears with the admin-edited text", async () => {
    const p = await createPartner({ displayName: `${FIXTURE_TAG} Reviewed Partner`, isRestricted: true });
    const requestText = `${FIXTURE_TAG} will be reviewed then shown`;
    await createPrayerRequest(p.id, requestText);
    const row = await prisma.pendingNotification.findFirst({
      where: { partnerId: p.id, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(row);

    const editedText = "Pray for safety during an upcoming trip.";
    const putRes = await admin(`/api/notifications/pending/${row.id}`, {
      method: "PUT",
      body: { text: editedText },
    });
    assert.equal(putRes.status, 200);

    const res = await anon("/api/public/prayer-wall");
    assert.equal(res.status, 200);
    const item = res.body.find((i) => i.partnerId === p.id);
    assert.ok(item, "should now appear after review");
    assert.equal(item.bodyText, editedText);
  });

  test("no stamping -- viewing the wall twice never changes the row", async () => {
    const p = await createPartner({});
    const requestText = `${FIXTURE_TAG} viewing never consumes`;
    await createPrayerRequest(p.id, requestText);
    const before_ = await prisma.pendingNotification.findFirst({
      where: { partnerId: p.id, payload: { path: ["requestText"], equals: requestText } },
    });
    assert.ok(before_);

    await anon("/api/public/prayer-wall");
    await anon("/api/public/prayer-wall");

    const afterRow = await prisma.pendingNotification.findUnique({ where: { id: before_.id } });
    assert.ok(afterRow, "row must still exist, untouched");
    assert.equal(afterRow.weeklyDigestSentAt, null);
    assert.equal(afterRow.biweeklyDigestSentAt, null);
    assert.equal(afterRow.monthlyDigestSentAt, null);
  });
});
