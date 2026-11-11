const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

// Same mock-the-whole-domain technique dispatches.test.js already
// uses for Postmark -- monkey-patch global.fetch, matching only the
// Postmark host, so no real email ever sends in this suite.
const realFetch = global.fetch;
let postmarkCalls = [];
function mockPostmark() {
  postmarkCalls = [];
}
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    postmarkCalls.push({ url, options });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" }),
    });
  }
  return realFetch(url, options);
};

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

let admin;
let anon;

async function createPublicPartner(overrides) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Subscribe Test Partner`,
      isPublic: true,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function removeFixtureSubscribers() {
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: "route-test-sub" } } });
}

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
  await removeFixtureSubscribers();
  // Fully on: publicPrayerDigest + its two dependencies. Individual
  // tests narrow this down to check the gating itself.
  await setFeatures({ publicPrayerDigest: true, publicDirectory: true, outboundEmail: true });
  await admin("/api/settings/email", {
    method: "PUT",
    body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.test" },
  });
});

beforeEach(() => mockPostmark());

after(async () => {
  global.fetch = realFetch;
  await removeFixtureSubscribers();
  await removeFixturePartners();
  await setFeatures({ publicPrayerDigest: false, publicDirectory: true, outboundEmail: false });
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/public/subscribe", () => {
  test("a new email gets the generic response, an unconfirmed row, and a confirmation email", async () => {
    const email = "route-test-sub-new@example.test";
    const res = await anon("/api/public/subscribe", { method: "POST", body: { email } });
    assert.equal(res.status, 200);
    assert.ok(res.body.message);

    const row = await prisma.publicSubscriber.findUnique({ where: { email } });
    assert.ok(row, "subscriber row should exist");
    assert.equal(row.confirmedAt, null);
    assert.equal(postmarkCalls.length, 1, "a confirmation email should have been sent");
  });

  test("subscribing again while still unconfirmed re-sends the confirmation, no duplicate row", async () => {
    const email = "route-test-sub-reconfirm@example.test";
    await anon("/api/public/subscribe", { method: "POST", body: { email } });
    const firstCount = await prisma.publicSubscriber.count({ where: { email } });
    mockPostmark();

    const res = await anon("/api/public/subscribe", { method: "POST", body: { email, allPartners: false } });
    assert.equal(res.status, 200);
    const secondCount = await prisma.publicSubscriber.count({ where: { email } });
    assert.equal(secondCount, firstCount, "no duplicate row");
    assert.equal(postmarkCalls.length, 1, "confirmation should be re-sent while unconfirmed");
  });

  test("re-subscribing an already-confirmed email updates scope but sends no email (no enumeration)", async () => {
    const email = "route-test-sub-confirmed@example.test";
    await anon("/api/public/subscribe", { method: "POST", body: { email } });
    const row = await prisma.publicSubscriber.findUnique({ where: { email } });
    await prisma.publicSubscriber.update({ where: { id: row.id }, data: { confirmedAt: new Date() } });
    mockPostmark();

    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email, cadence: "monthly" },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.message, "same generic response shape as the new-subscriber case");
    assert.equal(postmarkCalls.length, 0, "an already-confirmed subscriber gets no new confirmation email");

    const updated = await prisma.publicSubscriber.findUnique({ where: { email } });
    assert.equal(updated.cadence, "monthly", "scope/cadence still updates");
    assert.ok(updated.confirmedAt, "stays confirmed");
  });

  test("an invalid/non-public/archived partnerId is silently dropped, not an error", async () => {
    const email = "route-test-sub-badpartner@example.test";
    const archived = await createPublicPartner({});
    const archiveRes = await admin(`/api/partners/${archived.id}/archive`, { method: "POST" });
    assert.equal(archiveRes.status, 200, JSON.stringify(archiveRes.body));
    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email, allPartners: false, partnerIds: ["not-a-real-id", archived.id] },
    });
    assert.equal(res.status, 200);
    const row = await prisma.publicSubscriber.findUnique({
      where: { email },
      include: { scopedPartners: true },
    });
    assert.equal(row.scopedPartners.length, 0, "neither bogus nor archived partner should be kept");
  });

  test("a valid, public, non-archived partnerId is kept", async () => {
    const email = "route-test-sub-goodpartner@example.test";
    const partner = await createPublicPartner({});
    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email, allPartners: false, partnerIds: [partner.id] },
    });
    assert.equal(res.status, 200);
    const row = await prisma.publicSubscriber.findUnique({
      where: { email },
      include: { scopedPartners: true },
    });
    assert.equal(row.scopedPartners.length, 1);
    assert.equal(row.scopedPartners[0].partnerId, partner.id);
  });

  test("multiple valid partnerIds in one request are all kept", async () => {
    const email = "route-test-sub-multipartner@example.test";
    const [first, second] = await Promise.all([createPublicPartner({}), createPublicPartner({})]);
    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email, allPartners: false, partnerIds: [first.id, second.id] },
    });
    assert.equal(res.status, 200);
    const row = await prisma.publicSubscriber.findUnique({
      where: { email },
      include: { scopedPartners: true },
    });
    const keptIds = row.scopedPartners.map((p) => p.partnerId).sort();
    assert.deepEqual(keptIds, [first.id, second.id].sort());
  });

  test("404s when publicPrayerDigest is off", async () => {
    await setFeatures({ publicPrayerDigest: false });
    try {
      const res = await anon("/api/public/subscribe", {
        method: "POST",
        body: { email: "route-test-sub-gated@example.test" },
      });
      assert.equal(res.status, 404);
    } finally {
      await setFeatures({ publicPrayerDigest: true });
    }
  });

  test("404s on subscribe specifically when outboundEmail is off", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const res = await anon("/api/public/subscribe", {
        method: "POST",
        body: { email: "route-test-sub-noemail@example.test" },
      });
      assert.equal(res.status, 404);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});

describe("GET /api/public/subscribe/confirm", () => {
  test("a valid confirm token sets confirmedAt and renders a page", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-tokentest@example.test" },
    });
    const token = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/html"));

    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.ok(after.confirmedAt);
  });

  test("an invalid token is rejected with a 400 page, no DB write", async () => {
    const res = await anon("/api/public/subscribe/confirm?token=garbage");
    assert.equal(res.status, 400);
  });

  test("an unsubscribe-token used on confirm is rejected (discriminator check)", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-wrongtoken@example.test" },
    });
    const unsubscribeToken = jwt.sign(
      { id: row.id, subscriberUnsubscribe: true },
      process.env.SESSION_SECRET
    );
    const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(unsubscribeToken)}`);
    assert.equal(res.status, 400);
    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.equal(after.confirmedAt, null, "must not have been confirmed by the wrong token type");
  });

  test("confirm still works even when outboundEmail is off", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const row = await prisma.publicSubscriber.create({
        data: { email: "route-test-sub-noemailconfirm@example.test" },
      });
      const token = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
      const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});

describe("GET /api/public/unsubscribe", () => {
  test("a valid unsubscribe token deletes the subscriber row (cascading the join table)", async () => {
    const partner = await createPublicPartner({});
    const row = await prisma.publicSubscriber.create({
      data: {
        email: "route-test-sub-unsub@example.test",
        allPartners: false,
        scopedPartners: { create: [{ partnerId: partner.id }] },
      },
    });
    const token = jwt.sign({ id: row.id, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);

    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.equal(after, null, "row should be deleted outright, not flagged");
    const joinRows = await prisma.publicSubscriberPartner.findMany({ where: { subscriberId: row.id } });
    assert.equal(joinRows.length, 0, "join-table rows should cascade");
  });

  test("re-hitting an already-unsubscribed link degrades gracefully, not a 500", async () => {
    const token = jwt.sign(
      { id: "00000000-0000-0000-0000-000000000000", subscriberUnsubscribe: true },
      process.env.SESSION_SECRET
    );
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
  });

  test("a confirm-token used on unsubscribe is rejected (discriminator check)", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-wrongtoken2@example.test" },
    });
    const confirmToken = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(confirmToken)}`);
    assert.equal(res.status, 400);
    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.ok(after, "must not have been deleted by the wrong token type");
  });

  test("404s when publicPrayerDigest is off", async () => {
    await setFeatures({ publicPrayerDigest: false });
    try {
      const res = await anon("/api/public/unsubscribe?token=garbage");
      assert.equal(res.status, 404);
    } finally {
      await setFeatures({ publicPrayerDigest: true });
    }
  });
});
