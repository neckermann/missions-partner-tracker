// #327 Finding 4 -- public, unauthenticated application-submission surface
// had no previous test coverage at all. Covers the new input caps, the
// honeypot, and that the route's own (now-reduced) body-size limit
// actually applies here.
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

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();

  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ trips: true, publicTripDiscovery: true });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

async function createAcceptingTrip() {
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} applications` },
  });
  const trip = await admin("/api/trips", {
    method: "POST",
    body: {
      partnerId: partner.body.id,
      type: "Construction",
      isPublic: true,
      status: "accepting_applications",
    },
  });
  return trip.body;
}

function validApplication(overrides = {}) {
  return {
    firstName: "Pat",
    lastName: "Applicant",
    email: "pat-applicant@example.test",
    dateOfBirth: "1990-01-01",
    ...overrides,
  };
}

describe("POST /api/public/trips/:id/apply", () => {
  test("a valid submission is accepted", async () => {
    const trip = await createAcceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: validApplication(),
    });
    assert.equal(res.status, 201);
    const count = await prisma.tripApplication.count({ where: { tripId: trip.id } });
    assert.equal(count, 1);
  });

  // #327 Finding 4: every string on this schema was unbounded before.
  test("an oversized firstName is rejected", async () => {
    const trip = await createAcceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: validApplication({ firstName: "x".repeat(101) }),
    });
    assert.equal(res.status, 400);
    const count = await prisma.tripApplication.count({ where: { tripId: trip.id } });
    assert.equal(count, 0);
  });

  test("more than 100 responses entries is rejected", async () => {
    const trip = await createAcceptingTrip();
    const responses = {};
    for (let i = 0; i < 101; i++) responses[`q${i}`] = "an answer";
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: validApplication({ responses }),
    });
    assert.equal(res.status, 400);
  });

  // #327 Finding 4: a field the real form never shows. A filled honeypot
  // gets the exact same success response a real submission gets, but
  // nothing is written.
  test("a filled honeypot looks like success but writes nothing", async () => {
    const trip = await createAcceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: validApplication({ website: "https://spam.example" }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { submitted: true });
    const count = await prisma.tripApplication.count({ where: { tripId: trip.id } });
    assert.equal(count, 0);
  });

  // #327 Finding 4: the global default dropped from 15mb to 100kb, and
  // this route gets none of the larger scoped exceptions (those are only
  // the Postmark webhook and the two base64-image routes) -- confirms the
  // reduced default actually reaches this route, not just that it exists
  // somewhere in server.js.
  test("a body over the reduced default limit is rejected", async () => {
    const trip = await createAcceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: validApplication({ responses: { essay: "x".repeat(200 * 1024) } }),
    });
    assert.equal(res.status, 413);
  });
});
