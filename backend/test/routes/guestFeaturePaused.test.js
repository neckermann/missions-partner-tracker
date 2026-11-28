// A guest's access is tied to the feature it comes from: a trip leader's to Trips, a care team member's to Care
// teams. While that switch is off the access stops server-side (not only on screen) and the guest is told their
// church has paused it, instead of being bounced to sign-in; switching it back on restores it unchanged.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
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
let viewer;
let originalFeatures;
let tripPartner;
let carePartner;
let trip;
const madeUsers = [];

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

async function makeGuest(tag) {
  const email = `route-test-paused-${tag}@example.test`;
  const password = "RouteTestPaused123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role: "guest", active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  madeUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

const seat = (partnerId, userId) =>
  prisma.careTeamMember.create({ data: { partnerId, userId, isLead: false } });

before(async () => {
  await ensureTestUsers();
  [admin, viewer] = await Promise.all([client("admin"), client("viewer")]);
  await removeFixturePartners();
  originalFeatures =
    (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures ?? {};
  await setFeatures({ trips: true, careTeam: true, prayerRequests: true });
  tripPartner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} tripP` },
    })
  ).body;
  carePartner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} careP` },
    })
  ).body;
  trip = await prisma.trip.create({ data: { partnerId: tripPartner.id, status: "planning" } });
});

after(async () => {
  await prisma.careTeamMember.deleteMany({ where: { userId: { in: madeUsers } } });
  await prisma.tripAccess.deleteMany({ where: { userId: { in: madeUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  await prisma.trip.deleteMany({ where: { id: trip.id } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await stopServer();
});

const expectPaused = (res, feature) => {
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.code, "feature_paused");
  assert.deepEqual(res.body.features, [feature]);
};

describe("a trip leader guest", () => {
  let me;
  before(async () => {
    const g = await makeGuest("leader");
    await prisma.tripAccess.create({ data: { userId: g.user.id, tripId: trip.id } });
    me = await g.login();
  });

  test("with trips on, keeps full read access to the trip and its partner", async () => {
    await setFeatures({ trips: true });
    assert.equal((await me(`/api/trips/${trip.id}`)).status, 200);
    const partner = await me(`/api/partners/${tripPartner.id}`);
    assert.equal(partner.status, 200);
    assert.equal(partner.body.id, tripPartner.id);
    const who = await me("/api/auth/me");
    assert.equal(who.status, 200);
    assert.deepEqual(who.body.user.pausedFeatures, []);
    assert.equal(who.body.user.guestTrips.length, 1);
  });

  test("with trips off, is refused server-side everywhere, and told it is paused", async () => {
    await setFeatures({ trips: false });
    try {
      expectPaused(await me(`/api/trips/${trip.id}`), "trips");
      expectPaused(await me(`/api/partners/${tripPartner.id}`), "trips");
      expectPaused(await me("/api/partners"), "trips");
      expectPaused(await me("/api/prayer-requests"), "trips");
      expectPaused(await me("/api/notifications/summary"), "trips");
      expectPaused(await me("/api/settings"), "trips");
      const who = await me("/api/auth/me");
      assert.equal(who.status, 200, "/me still answers, so the app can explain");
      assert.deepEqual(who.body.user.pausedFeatures, ["trips"]);
      assert.deepEqual(who.body.user.guestTrips, []);
      assert.deepEqual(who.body.user.guestReadTripIds, []);
    } finally {
      await setFeatures({ trips: true });
    }
  });

  test("with trips back on, access returns unchanged", async () => {
    assert.equal((await me(`/api/trips/${trip.id}`)).status, 200);
    assert.equal((await me(`/api/partners/${tripPartner.id}`)).status, 200);
    assert.equal(
      await prisma.tripAccess.count({
        where: { tripId: trip.id, user: { email: { contains: "paused-leader" } } },
      }),
      1,
      "the grant itself was never touched"
    );
  });
});

describe("a care team guest", () => {
  let me;
  before(async () => {
    const g = await makeGuest("carer");
    await seat(carePartner.id, g.user.id);
    me = await g.login();
  });

  test("with care teams on, reads their partner", async () => {
    assert.equal((await me(`/api/partners/${carePartner.id}`)).status, 200);
    assert.equal((await me(`/api/partners/${tripPartner.id}`)).status, 403);
  });

  test("with care teams off, is told it is paused rather than bounced to sign-in", async () => {
    await setFeatures({ careTeam: false });
    try {
      const partner = await me(`/api/partners/${carePartner.id}`);
      expectPaused(partner, "careTeam");
      expectPaused(await me("/api/prayer-requests"), "careTeam");
      const who = await me("/api/auth/me");
      assert.equal(who.status, 200);
      assert.deepEqual(who.body.user.pausedFeatures, ["careTeam"]);
      assert.deepEqual(who.body.user.careTeamSeats, []);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });

  test("with care teams back on, access returns unchanged", async () => {
    assert.equal((await me(`/api/partners/${carePartner.id}`)).status, 200);
    assert.equal((await me("/api/auth/me")).body.user.careTeamSeats.length, 1);
  });
});

describe("a guest with both kinds of access", () => {
  let me;
  before(async () => {
    const g = await makeGuest("both");
    await prisma.tripAccess.create({ data: { userId: g.user.id, tripId: trip.id } });
    await seat(carePartner.id, g.user.id);
    me = await g.login();
  });

  test("with only trips off, loses the trip and its partner but keeps the care team partner", async () => {
    await setFeatures({ trips: false });
    try {
      assert.equal((await me(`/api/partners/${carePartner.id}`)).status, 200);
      const tripSide = await me(`/api/partners/${tripPartner.id}`);
      assert.equal(tripSide.status, 403, "the trip's partner is no longer reachable");
      assert.notEqual(tripSide.body.code, "feature_paused", "they are not locked out entirely");
      const who = await me("/api/auth/me");
      assert.deepEqual(who.body.user.pausedFeatures, ["trips"]);
      assert.deepEqual(who.body.user.guestTrips, []);
    } finally {
      await setFeatures({ trips: true });
    }
  });

  test("with only care teams off, keeps the trip and its partner", async () => {
    await setFeatures({ careTeam: false });
    try {
      assert.equal((await me(`/api/trips/${trip.id}`)).status, 200);
      assert.equal((await me(`/api/partners/${tripPartner.id}`)).status, 200);
      assert.equal((await me(`/api/partners/${carePartner.id}`)).status, 403);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });
});

describe("everyone else is unchanged", () => {
  test("a guest with no grant at all is still turned away as signed out", async () => {
    const g = await makeGuest("nothing");
    const me = await g.login().catch(() => null);
    if (me) assert.equal((await me("/api/auth/me")).status, 401);
  });

  test("a viewer is unaffected by either switch", async () => {
    await setFeatures({ trips: false, careTeam: false });
    try {
      assert.equal((await viewer("/api/auth/me")).status, 200);
      assert.equal((await viewer(`/api/partners/${tripPartner.id}`)).status, 200);
    } finally {
      await setFeatures({ trips: true, careTeam: true });
    }
  });
});
