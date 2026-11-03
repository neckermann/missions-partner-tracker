const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_USERS } = require("./helpers");

let admin;
let adminId;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  const adminRow = await prisma.user.findUnique({ where: { email: TEST_USERS.admin.email } });
  adminId = adminRow.id;
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/users/:id/mfa/reset", () => {
  test("an admin cannot reset their own MFA through this route", async () => {
    // auth.js's self-service /mfa/disable deliberately requires the
    // current password first, so a hijacked browser tab can't silently
    // strip MFA off the account. This route is the recovery path for
    // someone *else's* lost device -- targeting your own account through
    // it would reach the same end state with no password check at all.
    const res = await admin(`/api/users/${adminId}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Account Settings/);
  });

  test("an admin can reset another user's MFA", async () => {
    const other = await prisma.user.findUnique({ where: { email: TEST_USERS.editor.email } });
    const res = await admin(`/api/users/${other.id}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaEnabled, false);
  });
});
