// Trips (#252) -- focused coverage of the parts most likely to be gotten
// wrong by generic instinct: the feature-gate split between `trips` and
// `publicTripDiscovery`, the restricted-partner mask-vs-exclude split
// across public surfaces, and the lost-link recovery route's
// enumeration-prevention guarantee. Ordinary CRUD is already covered by
// collections.test.js/errors.test.js's shared parameterized cases.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

// Same mock-the-whole-domain technique publicSubscribe.test.js/
// dispatches.test.js already use for Postmark -- monkey-patch
// global.fetch, matching only the Postmark host, so no real email ever
// sends in this suite.
const realFetch = global.fetch;
global.fetch = (url, options) => {
  if (String(url).startsWith("https://api.postmarkapp.com")) {
    const body = { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  return realFetch(url, options);
};

let admin;
let anon;
let originalEnabledFeatures;

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), ...patch };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

async function setTripsSettings(patch) {
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: patch });
}

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();

  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ trips: true, publicTripDiscovery: true, outboundEmail: true });
  await setTripsSettings({ allowPrivateApplicationLinks: true, allowPublicSupportRaisingLinks: true });
  await admin("/api/settings/email", {
    method: "PUT",
    body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.test" },
  });
});

after(async () => {
  global.fetch = realFetch;
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: originalEnabledFeatures } });
  await stopServer();
});

async function createPartner(overrides = {}) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} trips`, ...overrides },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe("Trips: feature gate", () => {
  test("publicTripDiscovery off 404s discovery and the plain application route, even with trips on and the trip isPublic", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, status: "accepting_applications", isPublic: true, type: "Construction" },
    });
    assert.equal(trip.status, 201);

    await setFeatures({ publicTripDiscovery: false });
    const list = await anon("/api/public/trips");
    assert.equal(list.status, 404);
    const plain = await anon(`/api/public/trips/${trip.body.id}`);
    assert.equal(plain.status, 404);
    await setFeatures({ publicTripDiscovery: true });

    const listOn = await anon("/api/public/trips");
    assert.equal(listOn.status, 200);
    assert.ok(listOn.body.some((t) => t.id === trip.body.id));
  });

  test("trips off 404s the backend router entirely", async () => {
    await setFeatures({ trips: false });
    const res = await admin("/api/trips");
    assert.equal(res.status, 404);
    await setFeatures({ trips: true });
  });
});

describe("Trips: restricted-partner handling -- three different rules, not one", () => {
  test("excluded from discovery and the plain application route; masked (not excluded) on the private-link application route and the support-raising page; unmasked on the self-service page", async () => {
    const partner = await createPartner({ isRestricted: true });
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        status: "accepting_applications",
        isPublic: true, // deliberately true -- restricted must override this
        type: "Construction",
        name: "Secret Destination Trip",
      },
    });
    assert.equal(trip.status, 201);

    // Discovery: excluded outright.
    const list = await anon("/api/public/trips");
    assert.ok(!list.body.some((t) => t.id === trip.body.id), "restricted trip must never appear in discovery");

    // Plain application route: excluded outright (404, not masked).
    const plain = await anon(`/api/public/trips/${trip.body.id}`);
    assert.equal(plain.status, 404);

    // Private application link: masked, not excluded -- still works.
    const generated = await admin(`/api/trips/${trip.body.id}/generate-application-link`, { method: "POST" });
    assert.equal(generated.status, 200);
    const token = generated.body.applicationShareToken;

    const viaToken = await anon(`/api/public/trips/by-token/${token}`);
    assert.equal(viaToken.status, 200);
    assert.equal(viaToken.body.isRestricted, true);
    assert.notEqual(viaToken.body.fieldDisplayName, partner.displayName, "masked view must not show the real partner name");

    // Support-raising page: masked, not excluded.
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie", shareToken: "test-share-token-restricted" },
    });
    const supportRaising = await anon(`/api/public/trips/participants/by-token/${participant.shareToken}`);
    assert.equal(supportRaising.status, 200);
    assert.notEqual(supportRaising.body.trip.fieldDisplayName, partner.displayName);

    // Self-service: real, unmasked data.
    const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
    const accessToken = buildTripParticipantAccessToken({ id: participant.id, accessTokenVersion: 0 });
    const selfService = await anon(`/api/public/trips/participants/access?token=${accessToken}`);
    assert.equal(selfService.status, 200);
    assert.equal(selfService.body.trip.fieldDisplayName, partner.fieldDisplayName || partner.displayName);
  });
});

describe("Trips: lost-link recovery enumeration prevention", () => {
  test("response is identical whether or not the email matches anything", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", { method: "POST", body: { partnerId: partner.id, type: "Construction" } });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Known", email: "known-participant@example.test" },
    });

    const matched = await anon("/api/public/trips/participants/request-access-link", {
      method: "POST",
      body: { email: "known-participant@example.test" },
    });
    const unmatched = await anon("/api/public/trips/participants/request-access-link", {
      method: "POST",
      body: { email: "nobody-like-this@example.test" },
    });
    assert.equal(matched.status, unmatched.status);
    assert.deepEqual(matched.body, unmatched.body, "response body must not reveal whether the email matched");
  });
});
