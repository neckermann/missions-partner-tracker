const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// Admin-configurable cadence tiers: the three ChurchSettings booleans gating which
// email-digest cadence tiers are offered, their exposure on the public unauthenticated
// settings endpoint, the settings PUT's all-three-disabled rejection, and the migration that
// bulk-reassigns anyone on a tier that just got disabled. The frontend filtering of the two
// cadence pickers (PublicSubscribeForm.jsx/AccountSettings.jsx) is covered by their own vitest
// suites.

let admin;
let anon;
let originalCadenceSettings;

const FIXTURE_EMAIL_PREFIX = "route-test-cadence-tiers";

async function setCadenceTiers(patch) {
  return admin("/api/settings/dispatches", { method: "PUT", body: patch });
}

async function removeFixtureUsers() {
  await prisma.user.deleteMany({ where: { email: { contains: FIXTURE_EMAIL_PREFIX } } });
}

async function removeFixtureSubscribers() {
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: FIXTURE_EMAIL_PREFIX } } });
}

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);

  originalCadenceSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { cadenceBiweeklyEnabled: true, cadenceMonthlyEnabled: true, cadenceQuarterlyEnabled: true },
  });

  await removeFixtureUsers();
  await removeFixtureSubscribers();
});

beforeEach(async () => {
  // Every test starts from the real app default (biweekly off, monthly +
  // quarterly on) regardless of what a previous test left behind.
  await setCadenceTiers({
    cadenceBiweeklyEnabled: false,
    cadenceMonthlyEnabled: true,
    cadenceQuarterlyEnabled: true,
  });
});

after(async () => {
  await removeFixtureUsers();
  await removeFixtureSubscribers();
  if (originalCadenceSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalCadenceSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/public/settings -- cadenceTiersEnabled", () => {
  test("reflects the app default (biweekly off, monthly + quarterly on)", async () => {
    const res = await anon("/api/public/settings");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.cadenceTiersEnabled, { biweekly: false, monthly: true, quarterly: true });
  });

  test("reflects a saved change, unauthenticated", async () => {
    await setCadenceTiers({ cadenceBiweeklyEnabled: true, cadenceMonthlyEnabled: false });
    const res = await anon("/api/public/settings");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.cadenceTiersEnabled, { biweekly: true, monthly: false, quarterly: true });
  });
});

describe("PUT /api/settings/dispatches -- all-three-disabled rejection", () => {
  test("rejects a request that would leave every tier disabled", async () => {
    const res = await setCadenceTiers({
      cadenceBiweeklyEnabled: false,
      cadenceMonthlyEnabled: false,
      cadenceQuarterlyEnabled: false,
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);

    // Nothing should have been written.
    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { cadenceBiweeklyEnabled: true, cadenceMonthlyEnabled: true, cadenceQuarterlyEnabled: true },
    });
    assert.ok(
      after.cadenceBiweeklyEnabled || after.cadenceMonthlyEnabled || after.cadenceQuarterlyEnabled,
      "at least one tier must still be enabled after a rejected PUT"
    );
  });

  test("rejects a partial PUT that disables the only other tier still on, merged against the saved state", async () => {
    // Starting state (from beforeEach): biweekly off, monthly on, quarterly on.
    // Disabling quarterly alone is fine (monthly stays on)...
    const ok = await setCadenceTiers({ cadenceQuarterlyEnabled: false });
    assert.equal(ok.status, 200);
    // ...but then disabling monthly too, in a PUT that doesn't even
    // mention quarterly, must be rejected: the merged result (quarterly
    // already off, monthly going off, biweekly already off) would leave
    // nothing enabled.
    const rejected = await setCadenceTiers({ cadenceMonthlyEnabled: false });
    assert.equal(rejected.status, 400);
  });

  test("accepts disabling two of three, leaving one enabled", async () => {
    const res = await setCadenceTiers({ cadenceBiweeklyEnabled: false, cadenceQuarterlyEnabled: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.cadenceMonthlyEnabled, true);
    assert.equal(res.body.cadenceQuarterlyEnabled, false);
    assert.equal(res.body.cadenceBiweeklyEnabled, false);
  });
});

describe("PUT /api/settings/dispatches -- migration of descoped subscribers", () => {
  test("reassigns Users and PublicSubscribers off a disabled tier to the first enabled fallback (monthly preferred)", async () => {
    // Start with all three enabled so biweekly subscribers are legal,
    // then disable biweekly -- fallback should be monthly (first in
    // preference order and still enabled).
    await setCadenceTiers({
      cadenceBiweeklyEnabled: true,
      cadenceMonthlyEnabled: true,
      cadenceQuarterlyEnabled: true,
    });

    const biweeklyUser = await prisma.user.create({
      data: {
        email: `${FIXTURE_EMAIL_PREFIX}-user-biweekly@example.test`,
        passwordHash: "x",
        role: "viewer",
        active: true,
        authProvider: "local",
        cadence: "biweekly",
      },
    });
    const monthlyUser = await prisma.user.create({
      data: {
        email: `${FIXTURE_EMAIL_PREFIX}-user-monthly@example.test`,
        passwordHash: "x",
        role: "viewer",
        active: true,
        authProvider: "local",
        cadence: "monthly",
      },
    });
    const unsubscribedUser = await prisma.user.create({
      data: {
        email: `${FIXTURE_EMAIL_PREFIX}-user-none@example.test`,
        passwordHash: "x",
        role: "viewer",
        active: true,
        authProvider: "local",
        cadence: null,
      },
    });
    const biweeklySubscriber = await prisma.publicSubscriber.create({
      data: { email: `${FIXTURE_EMAIL_PREFIX}-sub-biweekly@example.test`, cadence: "biweekly" },
    });
    const quarterlySubscriber = await prisma.publicSubscriber.create({
      data: { email: `${FIXTURE_EMAIL_PREFIX}-sub-quarterly@example.test`, cadence: "quarterly" },
    });

    const res = await setCadenceTiers({ cadenceBiweeklyEnabled: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.cadenceBiweeklyEnabled, false);

    const [
      reassignedUser,
      untouchedMonthlyUser,
      untouchedUnsubscribedUser,
      reassignedSubscriber,
      untouchedQuarterlySubscriber,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id: biweeklyUser.id } }),
      prisma.user.findUnique({ where: { id: monthlyUser.id } }),
      prisma.user.findUnique({ where: { id: unsubscribedUser.id } }),
      prisma.publicSubscriber.findUnique({ where: { id: biweeklySubscriber.id } }),
      prisma.publicSubscriber.findUnique({ where: { id: quarterlySubscriber.id } }),
    ]);

    assert.equal(
      reassignedUser.cadence,
      "monthly",
      "a biweekly user should be moved to the monthly fallback"
    );
    assert.equal(untouchedMonthlyUser.cadence, "monthly", "an already-monthly user should be untouched");
    assert.equal(untouchedUnsubscribedUser.cadence, null, "an unsubscribed user should stay unsubscribed");
    assert.equal(
      reassignedSubscriber.cadence,
      "monthly",
      "a biweekly public subscriber should be moved to the monthly fallback"
    );
    assert.equal(
      untouchedQuarterlySubscriber.cadence,
      "quarterly",
      "a quarterly public subscriber should be untouched by disabling biweekly"
    );
  });

  test("falls back to quarterly (next in preference order) when monthly is also disabled", async () => {
    await setCadenceTiers({
      cadenceBiweeklyEnabled: true,
      cadenceMonthlyEnabled: true,
      cadenceQuarterlyEnabled: true,
    });

    const biweeklyUser = await prisma.user.create({
      data: {
        email: `${FIXTURE_EMAIL_PREFIX}-user-biweekly2@example.test`,
        passwordHash: "x",
        role: "viewer",
        active: true,
        authProvider: "local",
        cadence: "biweekly",
      },
    });

    // Disable both monthly and biweekly in one PUT -- only quarterly is
    // left, so that's the fallback.
    const res = await setCadenceTiers({ cadenceBiweeklyEnabled: false, cadenceMonthlyEnabled: false });
    assert.equal(res.status, 200);

    const after = await prisma.user.findUnique({ where: { id: biweeklyUser.id } });
    assert.equal(after.cadence, "quarterly");
  });

  test("a PUT that doesn't disable any tier leaves every subscriber's cadence untouched", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${FIXTURE_EMAIL_PREFIX}-user-untouched@example.test`,
        passwordHash: "x",
        role: "viewer",
        active: true,
        authProvider: "local",
        cadence: "monthly",
      },
    });

    const res = await setCadenceTiers({ emailDispatchHour: 9 });
    assert.equal(res.status, 200);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(after.cadence, "monthly");
  });
});
