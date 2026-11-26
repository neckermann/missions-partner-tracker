// A3 of the November 2026 app review: first-run setup creates exactly one admin, however many requests
// arrive at once. Needs an EMPTY users table, so it empties it first, but only when every account there is
// a route-test fixture (never on a database that holds real accounts).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

const SETUP_EMAILS = [
  "first-admin-a@example.test",
  "first-admin-b@example.test",
  "first-admin-c@example.test",
];
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
    await prisma.user.deleteMany({ where: { email: { in: SETUP_EMAILS } } });
    if (savedSettings) {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { requireTwoFactor: savedSettings.requireTwoFactor },
      });
    } else {
      await prisma.churchSettings.deleteMany({ where: { id: "singleton" } });
    }
    await ensureTestUsers();
  }
  await removeTestUsers();
  await stopServer();
});

describe("first-run setup", () => {
  test("three requests at the same moment create exactly one admin", async (t) => {
    if (!canRun) return t.skip("this database holds accounts that are not test fixtures");
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
    assert.equal((await anon("/api/auth/setup-status")).body.needed, false);
  });

  test("once an account exists, setup is refused and says what to do", async (t) => {
    if (!canRun) return t.skip("this database holds accounts that are not test fixtures");
    const res = await anon("/api/auth/setup", {
      method: "POST",
      body: { email: "late@example.test", password: "A-Long-Passw0rd-For-Tests!" },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /redeploy/i);
  });
});
