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

describe("POST /api/users", () => {
  // Regression: sendWelcomeEmail defaults to true, so a caller that supplied a password without
  // sendWelcomeEmail: false (e.g. the e2e suite's user-creation helper) got a silently
  // passwordless account: the password was discarded and the account could never sign in. An
  // explicitly-given password must always be used.
  test("a password is used even when sendWelcomeEmail isn't explicitly set to false", async () => {
    const email = `created-${Date.now()}@example.test`;
    const password = "CreatedUserPassword123!";
    const res = await admin("/api/users", {
      method: "POST",
      body: { email, role: "viewer", password },
    });
    try {
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.welcomeEmail, { sent: false, skipped: true });

      const loggedIn = await client({ email, password });
      const self = await loggedIn("/api/auth/me");
      assert.equal(self.status, 200);
      assert.equal(self.body.user.email, email);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  // The generic P2002 handler's "That email is already in use" reads as a
  // form-validation complaint -- this route's own catch replaces it with
  // something that tells the admin what to do instead (edit the existing
  // account, don't create a second one).
  test("adding a user with an email that's already in use names the actual problem", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: TEST_USERS.admin.email, role: "viewer" },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already exists.*edit their existing account/i);
  });
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
