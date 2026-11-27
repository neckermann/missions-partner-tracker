// A church with a single active administrator is one lost phone from a lock-out only a server command can fix, so the
// bell and Home nudge it to add a second. The nudge goes away with a second active admin, and is admin-only.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_USERS } = require("./helpers");

let admin;
let editor;
let otherAdminIds = [];
let secondAdminId;

const summary = async (who) => (await who("/api/notifications/summary")).body.categories;
const keys = async (who) => (await summary(who)).map((c) => c.key);
// A category is listed with a count of 0 when there is nothing to do; the nudge is "on" when its count is 1.
const nudge = async (who) => (await summary(who)).find((c) => c.key === "onlyOneAdmin")?.count ?? 0;

before(async () => {
  await ensureTestUsers();
  [admin, editor] = await Promise.all([client("admin"), client("editor")]);
  // Any other active admin on this shared test database (CI creates one for the browser tests) is set aside for
  // the length of this file, so "exactly one administrator" is a fact of the test and not of the database.
  const mine = await prisma.user.findUnique({ where: { email: TEST_USERS.admin.email } });
  const others = await prisma.user.findMany({
    where: { role: "admin", active: true, id: { not: mine.id } },
    select: { id: true },
  });
  otherAdminIds = others.map((u) => u.id);
  await prisma.user.updateMany({ where: { id: { in: otherAdminIds } }, data: { active: false } });
});

after(async () => {
  if (secondAdminId) await prisma.user.deleteMany({ where: { id: secondAdminId } });
  await prisma.user.updateMany({ where: { id: { in: otherAdminIds } }, data: { active: true } });
  await removeTestUsers();
  await stopServer();
});

describe("the only-one-administrator nudge", () => {
  test("shows for an admin when there is exactly one active administrator", async () => {
    assert.equal(await nudge(admin), 1);
  });

  test("is not shown to an editor", async () => {
    assert.ok(!(await keys(editor)).includes("onlyOneAdmin"));
  });

  test("goes away once there is a second active administrator, and returns if they are deactivated", async () => {
    const second = await prisma.user.create({
      data: {
        email: `second-admin-${Date.now()}@example.test`,
        role: "admin",
        active: true,
        authProvider: "local",
      },
    });
    secondAdminId = second.id;
    assert.equal(await nudge(admin), 0);
    await prisma.user.update({ where: { id: second.id }, data: { active: false } });
    assert.equal(await nudge(admin), 1);
  });
});
