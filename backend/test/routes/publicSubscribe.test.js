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

  // Re-scoping an already-confirmed subscriber must not apply immediately: nothing is written
  // until a confirm-change link (sent to the address itself) is clicked, since the caller has
  // shown no proof of owning the email.
  test("re-subscribing an already-confirmed email sends a confirm-change email and does not apply yet", async () => {
    const email = "route-test-sub-confirmed@example.test";
    await anon("/api/public/subscribe", { method: "POST", body: { email } });
    const row = await prisma.publicSubscriber.findUnique({ where: { email } });
    await prisma.publicSubscriber.update({
      where: { id: row.id },
      data: { confirmedAt: new Date(), cadence: "quarterly" },
    });
    mockPostmark();

    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email, cadence: "monthly" },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.message, "same generic response shape as the new-subscriber case");
    assert.equal(postmarkCalls.length, 1, "a confirm-change email should be sent");

    const unchanged = await prisma.publicSubscriber.findUnique({ where: { email } });
    assert.equal(unchanged.cadence, "quarterly", "nothing applies until the confirm-change link is clicked");
    assert.ok(unchanged.confirmedAt, "stays confirmed");

    const sentBody = JSON.parse(postmarkCalls[0].options.body);
    const link = sentBody.TextBody.match(/\/api\/public\/subscribe\/confirm\?token=(\S+)/);
    assert.ok(link, "confirm-change email should contain a confirm link");

    // Opening the link shows a button and changes nothing; pressing it applies the change.
    const opened = await anon(`/api/public/subscribe/confirm?token=${link[1]}`);
    assert.equal(opened.status, 200);
    assert.equal((await prisma.publicSubscriber.findUnique({ where: { email } })).cadence, "quarterly");
    const confirmRes = await postConfirm(decodeURIComponent(link[1]));
    assert.equal(confirmRes.status, 200);
    const applied = await prisma.publicSubscriber.findUnique({ where: { email } });
    assert.equal(applied.cadence, "monthly", "clicking the confirm-change link applies the proposed change");
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

// The confirm button's form posts the token in the body, as a browser would.
const postConfirm = (token) =>
  anon("/api/public/subscribe/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${encodeURIComponent(token)}`,
  });

describe("GET and POST /api/public/subscribe/confirm", () => {
  // H4: opening the link only shows a button. A mail scanner that pre-opens links must never confirm anyone.
  test("GET renders a confirm button and does not confirm anyone by itself", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-confirm-get@example.test" },
    });
    const token = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/html"));
    assert.match(res.body, /Confirm my subscription/);
    assert.match(res.body, /method="POST"/);
    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.equal(after.confirmedAt, null, "GET must not confirm");
  });

  test("GET on a confirm-change link shows the change button and applies nothing", async () => {
    const row = await prisma.publicSubscriber.create({
      data: {
        email: "route-test-sub-confirm-change-get@example.test",
        confirmedAt: new Date(),
        cadence: "quarterly",
      },
    });
    const token = jwt.sign(
      { id: row.id, subscriberConfirmChange: true, cadence: "monthly", allPartners: true, partnerIds: [] },
      process.env.SESSION_SECRET
    );
    const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Confirm the change/);
    assert.equal((await prisma.publicSubscriber.findUnique({ where: { id: row.id } })).cadence, "quarterly");
  });

  test("POST with a valid confirm token sets confirmedAt and renders a page", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-tokentest@example.test" },
    });
    const token = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
    const res = await postConfirm(token);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/html"));

    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.ok(after.confirmedAt);
  });

  test("an invalid token is rejected with a 400 page, no DB write", async () => {
    assert.equal((await anon("/api/public/subscribe/confirm?token=garbage")).status, 400);
    assert.equal((await postConfirm("garbage")).status, 400);
  });

  test("a token in the query string of a POST is ignored: only the form body counts", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-confirm-query@example.test" },
    });
    const token = jwt.sign({ id: row.id, subscriberConfirm: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    assert.equal(res.status, 400);
    assert.equal((await prisma.publicSubscriber.findUnique({ where: { id: row.id } })).confirmedAt, null);
  });

  test("an unsubscribe-token used on confirm is rejected (discriminator check)", async () => {
    const row = await prisma.publicSubscriber.create({
      data: { email: "route-test-sub-wrongtoken@example.test" },
    });
    const unsubscribeToken = jwt.sign(
      { id: row.id, subscriberUnsubscribe: true },
      process.env.SESSION_SECRET
    );
    const res = await postConfirm(unsubscribeToken);
    assert.equal(res.status, 400);
    assert.equal(
      (await anon(`/api/public/subscribe/confirm?token=${encodeURIComponent(unsubscribeToken)}`)).status,
      400
    );
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
      const res = await postConfirm(token);
      assert.equal(res.status, 200);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});

describe("GET/POST /api/public/unsubscribe", () => {
  // GET only verifies the token and renders a confirm page; it must not mutate anything by
  // itself (a mail security scanner pre-fetching the link must never unsubscribe anyone).
  test("GET with a valid token renders a confirm page, without deleting the subscriber yet", async () => {
    const partner = await createPublicPartner({});
    const row = await prisma.publicSubscriber.create({
      data: {
        email: "route-test-sub-unsub-get@example.test",
        allPartners: false,
        scopedPartners: { create: [{ partnerId: partner.id }] },
      },
    });
    const token = jwt.sign({ id: row.id, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Confirm unsubscribe/);

    const stillThere = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.ok(stillThere, "GET must not delete the row");
  });

  test("POST with a valid token deletes the subscriber row (cascading the join table)", async () => {
    const partner = await createPublicPartner({});
    const row = await prisma.publicSubscriber.create({
      data: {
        email: "route-test-sub-unsub@example.test",
        allPartners: false,
        scopedPartners: { create: [{ partnerId: partner.id }] },
      },
    });
    const token = jwt.sign({ id: row.id, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
    // Token in the query string, same as the RFC 8058 one-click path a
    // mail client's own "Unsubscribe" button would use.
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
    assert.equal(res.status, 200);

    const after = await prisma.publicSubscriber.findUnique({ where: { id: row.id } });
    assert.equal(after, null, "row should be deleted outright, not flagged");
    const joinRows = await prisma.publicSubscriberPartner.findMany({ where: { subscriberId: row.id } });
    assert.equal(joinRows.length, 0, "join-table rows should cascade");
  });

  test("re-POSTing an already-unsubscribed link degrades gracefully, not a 500", async () => {
    const token = jwt.sign(
      { id: "00000000-0000-0000-0000-000000000000", subscriberUnsubscribe: true },
      process.env.SESSION_SECRET
    );
    const res = await anon(`/api/public/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
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
