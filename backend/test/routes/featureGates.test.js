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

// GET /api/partners?include=full is the booklet's data source: every partner
// with every relation, including prayer requests. It sat on a router with no
// feature gate at all, so turning off Print booklet did nothing server-side,
// and a church that had turned Prayer Requests off still served every
// request through this one query -- private and situational ones included.
//
// Feature toggles live in a single settings row, so these tests mutate
// global state. They restore it in after(), and `npm run test:routes` runs
// with --test-concurrency=1 so nothing else reads it mid-flight.

let admin;
let originalFeatures;

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { ...(current?.enabledFeatures || {}), ...patch } },
  });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures || {};

  await removeFixturePartners();
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} booklet host` },
  });
  await admin("/api/prayer-requests", {
    method: "POST",
    body: {
      partnerId: partner.body.id,
      category: "situational",
      requestText: `${FIXTURE_TAG} a private request`,
      dateReceived: "2026-01-01",
    },
  });
});

after(async () => {
  // Restore even if a test threw -- this row is shared by the whole app.
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("booklet feature gate", () => {
  test("with both features on, the deep record includes prayer requests", async () => {
    await setFeatures({ booklet: true, prayerRequests: true });

    const res = await admin("/api/partners?include=full");
    assert.equal(res.status, 200);
    const host = res.body.find((p) => p.displayName.includes("booklet host"));
    assert.ok(host, "fixture partner should be in the response");
    assert.ok(Array.isArray(host.prayerRequests), "prayerRequests should be included");
    assert.ok(host.prayerRequests.length > 0);
  });

  test("turning off Prayer Requests stops them being served here", async () => {
    await setFeatures({ booklet: true, prayerRequests: false });

    const res = await admin("/api/partners?include=full");
    assert.equal(res.status, 200, "the booklet itself is still on");
    const host = res.body.find((p) => p.displayName.includes("booklet host"));
    assert.ok(host, "the partner is still returned");
    // Either the key is gone or it's empty -- what must not happen is the
    // request text coming back.
    const serialized = JSON.stringify(host);
    assert.doesNotMatch(serialized, /a private request/, "prayer request text must not be served");
  });

  test("turning off Print booklet 404s the deep record entirely", async () => {
    await setFeatures({ booklet: false, prayerRequests: true });

    const res = await admin("/api/partners?include=full");
    assert.equal(res.status, 404);
  });

  test("the ordinary partner list is unaffected by either toggle", async () => {
    await setFeatures({ booklet: false, prayerRequests: false });

    const res = await admin("/api/partners");
    assert.equal(res.status, 200, "the list is not a booklet feature");
    assert.ok(Array.isArray(res.body));
  });
});
