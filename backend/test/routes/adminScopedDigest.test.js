const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let viewer;
let unauthenticated;

async function removeFixtureSubscribers() {
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: "route-test-summary" } } });
}

before(async () => {
  await ensureTestUsers();
  [admin, viewer, unauthenticated] = await Promise.all([client("admin"), client("viewer"), client(null)]);
  await removeFixtureSubscribers();
});

after(async () => {
  await removeFixtureSubscribers();
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/scoped-digest/summary", () => {
  test("requires a session", async () => {
    assert.equal((await unauthenticated("/api/scoped-digest/summary")).status, 401);
  });

  test("any authenticated role can read it, with real counts and no email addresses", async () => {
    await prisma.publicSubscriber.create({
      data: { email: "route-test-summary-confirmed@example.test", confirmedAt: new Date() },
    });
    await prisma.publicSubscriber.create({
      data: { email: "route-test-summary-unconfirmed@example.test" },
    });

    for (const asRole of [admin, viewer]) {
      const res = await asRole("/api/scoped-digest/summary");
      assert.equal(res.status, 200);
      assert.ok(res.body.publicConfirmedCount >= 1);
      assert.ok(res.body.publicUnconfirmedCount >= 1);
      assert.ok(typeof res.body.adminSubscribedCount === "number");
      assert.equal(
        JSON.stringify(res.body).includes("@example.test"),
        false,
        "no email addresses in the response"
      );
    }
  });
});
