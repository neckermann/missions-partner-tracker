// A3 of the November 2026 app review: first-run setup creates exactly one admin, however many requests
// arrive at once. Needs an EMPTY users table, so it empties it first, but only when every account there is
// a route-test fixture (never on a database that holds real accounts).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { generate } = require("otplib");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

const SETUP_EMAILS = [
  "first-admin-a@example.test",
  "first-admin-b@example.test",
  "first-admin-c@example.test",
];
const CHOICE_EMAILS = ["first-admin-password@example.test", "first-admin-passkey@example.test"];
let anon;
let canRun = false;
let savedSettings; // setup turns two-factor on for the whole church; later test files must not inherit that

before(async () => {
  anon = await client(null);
  const users = await prisma.user.findMany({ select: { email: true } });
  canRun = users.every((u) => u.email.endsWith("@example.test"));
  if (canRun) {
    savedSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await removeTestUsers();
    await prisma.user.deleteMany({});
  }
});

after(async () => {
  if (canRun) {
    await prisma.user.deleteMany({ where: { email: { in: [...SETUP_EMAILS, ...CHOICE_EMAILS] } } });
    if (savedSettings) {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: {
          requireTwoFactor: savedSettings.requireTwoFactor,
          chatDispatchHour: savedSettings.chatDispatchHour,
          emailDispatchDayOfMonth: savedSettings.emailDispatchDayOfMonth,
          emailDispatchHour: savedSettings.emailDispatchHour,
        },
      });
    } else {
      await prisma.churchSettings.deleteMany({ where: { id: "singleton" } });
    }
    await ensureTestUsers();
  }
  await removeTestUsers();
  await stopServer();
});

// These two need a database with no accounts but the test fixtures. On a developer's database that may not be so,
// and they say so and skip. In CI the database is built to be empty at this point (ci.yml creates the e2e admin
// AFTER the route tests), so a skip there means the suite is silently not testing first-run setup: that is a failure.
function cannotRun(t) {
  const why = "this database holds accounts that are not test fixtures";
  if (process.env.CI) assert.fail(`first-run setup could not run in CI: ${why}`);
  return t.skip(why);
}

describe("first-run setup", () => {
  test("three requests at the same moment create exactly one admin", async (t) => {
    if (!canRun) return cannotRun(t);
    assert.equal((await anon("/api/auth/setup-status")).body.needed, true);

    const results = await Promise.all(
      SETUP_EMAILS.map((email) =>
        anon("/api/auth/setup", { method: "POST", body: { email, password: "A-Long-Passw0rd-For-Tests!" } })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
    assert.equal(await prisma.user.count(), 1);
    const [admin] = await prisma.user.findMany();
    assert.equal(admin.role, "admin");
    // Nobody else is on the missions team on a new install, so the contact log and key-date reminders
    // (which go to whoever looks after a partner) would notify no one without this.
    assert.equal(admin.onMissionsTeam, true);
    assert.equal((await anon("/api/auth/setup-status")).body.needed, false);
  });

  test("once an account exists, setup is refused and says what to do", async (t) => {
    if (!canRun) return cannotRun(t);
    const res = await anon("/api/auth/setup", {
      method: "POST",
      body: { email: "late@example.test", password: "A-Long-Passw0rd-For-Tests!" },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /redeploy/i);
  });
});

// The first administrator chooses how to sign in, as anyone with a new account does, and is signed in straight
// away: setup hands back the enrolment token instead of sending them to a separate sign-in.
describe("the first administrator's choice of how to sign in", () => {
  const post = (path, body, headers) => anon(path, { method: "POST", body, headers });

  test("a password, then an authenticator app, signs them in with no extra sign-in", async (t) => {
    if (!canRun) return cannotRun(t);
    await prisma.user.deleteMany({});
    const res = await post("/api/auth/setup", {
      email: "first-admin-password@example.test",
      password: "A-Long-Passw0rd-For-Tests!",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.setupToken, "an enrolment token comes straight back");
    assert.equal(res.headers.getSetCookie().length, 0, "no session until the second factor is added");
    const bearer = { Authorization: `Bearer ${res.body.setupToken}` };
    const setup = await post("/api/auth/mfa/setup", undefined, bearer);
    assert.equal(setup.status, 200);
    const verified = await post(
      "/api/auth/mfa/verify-setup",
      { token: await generate({ secret: setup.body.secret }) },
      bearer
    );
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const cookie = verified.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const me = await anon("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user?.role ?? me.body.role, "admin");
  });

  test("the first administrator's name is saved when given, and is optional", async (t) => {
    if (!canRun) return cannotRun(t);
    await prisma.user.deleteMany({});
    const named = await post("/api/auth/setup", {
      email: "first-admin-password@example.test",
      password: "A-Long-Passw0rd-For-Tests!",
      firstName: "  Dana ",
      lastName: "Reed",
    });
    assert.equal(named.status, 201, JSON.stringify(named.body));
    const row = await prisma.user.findUnique({ where: { email: "first-admin-password@example.test" } });
    assert.equal(row.firstName, "Dana", "trimmed");
    assert.equal(row.lastName, "Reed");

    await prisma.user.deleteMany({});
    const unnamed = await post("/api/auth/setup", {
      email: "first-admin-passkey@example.test",
      method: "passkey",
      firstName: "   ",
    });
    assert.equal(unnamed.status, 201, JSON.stringify(unnamed.body));
    const plain = await prisma.user.findUnique({ where: { email: "first-admin-passkey@example.test" } });
    assert.equal(plain.firstName, null, "blank is no name");
    assert.equal(plain.lastName, null);
  });

  test("a new install starts with a sharing schedule, and one already set is never overwritten", async (t) => {
    if (!canRun) return cannotRun(t);
    const schedule = () =>
      prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { chatDispatchHour: true, emailDispatchDayOfMonth: true, emailDispatchHour: true },
      });
    await prisma.user.deleteMany({});
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { chatDispatchHour: null, emailDispatchDayOfMonth: null, emailDispatchHour: null },
      create: { id: "singleton" },
    });
    const first = await post("/api/auth/setup", {
      email: "first-admin-schedule@example.test",
      password: "A-Long-Passw0rd-For-Tests!",
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(await schedule(), {
      chatDispatchHour: 9,
      emailDispatchDayOfMonth: 1,
      emailDispatchHour: 9,
    });

    await prisma.user.deleteMany({});
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { chatDispatchHour: 14, emailDispatchDayOfMonth: null, emailDispatchHour: 7 },
    });
    const again = await post("/api/auth/setup", {
      email: "first-admin-schedule2@example.test",
      password: "A-Long-Passw0rd-For-Tests!",
    });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.deepEqual(
      await schedule(),
      { chatDispatchHour: 14, emailDispatchDayOfMonth: 1, emailDispatchHour: 7 },
      "what was set stays; only the empty one is filled"
    );
  });

  test("a passkey needs no password: the account has none, and the enrolment token can register one", async (t) => {
    if (!canRun) return cannotRun(t);
    await prisma.user.deleteMany({});
    const res = await post("/api/auth/setup", {
      email: "first-admin-passkey@example.test",
      method: "passkey",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const admin = await prisma.user.findUnique({ where: { email: "first-admin-passkey@example.test" } });
    assert.equal(admin.passwordHash, null);
    assert.equal(admin.role, "admin");
    assert.equal(admin.onMissionsTeam, true);
    const options = await post(
      "/api/auth/passkeys/register/options",
      {},
      { Authorization: `Bearer ${res.body.setupToken}` }
    );
    assert.equal(options.status, 200, JSON.stringify(options.body));
  });

  test("a password is still required unless the passkey way is chosen", async (t) => {
    if (!canRun) return cannotRun(t);
    await prisma.user.deleteMany({});
    const res = await post("/api/auth/setup", { email: "first-admin-password@example.test" });
    assert.equal(res.status, 400);
    assert.equal(await prisma.user.count(), 0);
  });
});
