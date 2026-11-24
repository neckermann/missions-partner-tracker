// #327 Finding 7 -- a session token's sessionVersion claim (utils/jwt.js)
// must match User.sessionVersion (middleware/requireAuth.js) on every
// request. Covers each of the triggers that bump it: self-service
// password change, self-service MFA disable, an admin-set password
// reset, an admin role change, and an admin-forced MFA reset -- each
// time confirming a session cookie captured *before* the trigger stops
// working afterward, and (for the self-service routes, which re-issue a
// cookie in the same response) that the current tab's own session keeps
// working via its fresh cookie. Logout is deliberately NOT one of these
// triggers (confirmed by its own test below) -- it stays scoped to the
// one cookie/browser it represents.
require("dotenv").config({ quiet: true });
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { client, startServer, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
const PASSWORD = "SessionVersionTest123!";

async function createTarget(overrides = {}) {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: throwaway fixture
  return prisma.user.create({
    data: {
      email: `route-test-sessionversion-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      passwordHash,
      role: "editor",
      active: true,
      authProvider: "local",
      ...overrides,
    },
  });
}

// Mirrors helpers.js's own client() login mechanics, but returns the raw
// cookie string instead of a bound request function -- this file needs to
// hold onto a specific cookie value across multiple logins of the same
// account (a "before" and an "after" one), which client()'s closure
// doesn't expose.
async function loginRaw(email, password) {
  const base = await startServer();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login as ${email} failed: ${res.status}`);
  return {
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    setCookieHeaders: res.headers.getSetCookie(),
  };
}

async function meWithCookie(cookie) {
  const base = await startServer();
  return fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: "route-test-sessionversion-" } } });
  await removeTestUsers();
  await stopServer();
});

describe("#327 Finding 7 -- self-service password change", () => {
  test("the old session is rejected, the newly-issued cookie still works", async () => {
    const target = await createTarget();
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);
    assert.equal((await meWithCookie(oldCookie)).status, 200, "sanity: old cookie works before the change");

    const base = await startServer();
    const changeRes = await fetch(`${base}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: oldCookie },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "NewSessionVersionTest123!" }),
    });
    assert.equal(changeRes.status, 200);
    const newCookie = changeRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    assert.ok(newCookie, "change-password must re-issue a session cookie");

    assert.equal((await meWithCookie(oldCookie)).status, 401, "the pre-change cookie must now be rejected");
    assert.equal((await meWithCookie(newCookie)).status, 200, "the re-issued cookie must still work");
  });
});

describe("#327 Finding 7 -- self-service MFA disable", () => {
  test("the old session is rejected, the newly-issued cookie still works", async () => {
    // Logs in BEFORE mfaEnabled is set -- a login against an account with
    // mfaEnabled already true returns { mfaRequired: true, pendingToken }
    // instead of a real session cookie, which this test needs (it's about
    // sessionVersion, not about exercising real MFA enrollment/login,
    // covered elsewhere). mfaSecret set directly for the same reason.
    const target = await createTarget();
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);
    await prisma.user.update({
      where: { id: target.id },
      data: { mfaEnabled: true, mfaSecret: "not-a-real-encrypted-secret" },
    });

    const base = await startServer();
    const disableRes = await fetch(`${base}/api/auth/mfa/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: oldCookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(disableRes.status, 200);
    const newCookie = disableRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    assert.ok(newCookie, "mfa/disable must re-issue a session cookie");

    assert.equal((await meWithCookie(oldCookie)).status, 401);
    assert.equal((await meWithCookie(newCookie)).status, 200);
  });
});

describe("#327 Finding 7 -- an admin-set password reset", () => {
  test("every existing session for that account is rejected", async () => {
    const target = await createTarget();
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);
    assert.equal((await meWithCookie(oldCookie)).status, 200);

    const res = await admin(`/api/users/${target.id}`, {
      method: "PUT",
      body: { password: "AdminResetSessionVersionTest123!" },
    });
    assert.equal(res.status, 200);

    assert.equal((await meWithCookie(oldCookie)).status, 401);
  });
});

describe("#327 Finding 7 -- an admin role change", () => {
  test("every existing session for that account is rejected", async () => {
    const target = await createTarget({ role: "viewer" });
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);
    assert.equal((await meWithCookie(oldCookie)).status, 200);

    const res = await admin(`/api/users/${target.id}`, { method: "PUT", body: { role: "editor" } });
    assert.equal(res.status, 200);

    assert.equal((await meWithCookie(oldCookie)).status, 401);
  });

  test("an unrelated field update (no password, no role change) does NOT invalidate the session", async () => {
    const target = await createTarget();
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);

    const res = await admin(`/api/users/${target.id}`, { method: "PUT", body: { firstName: "Renamed" } });
    assert.equal(res.status, 200);

    assert.equal(
      (await meWithCookie(oldCookie)).status,
      200,
      "a plain field edit must not bump sessionVersion"
    );
  });
});

describe("#327 Finding 7 -- an admin-forced MFA reset", () => {
  test("every existing session for that account is rejected", async () => {
    // Same login-before-mfaEnabled ordering as the self-service MFA
    // disable test above, and for the same reason.
    const target = await createTarget();
    const { cookie: oldCookie } = await loginRaw(target.email, PASSWORD);
    await prisma.user.update({
      where: { id: target.id },
      data: { mfaEnabled: true, mfaSecret: "not-a-real-encrypted-secret" },
    });
    assert.equal((await meWithCookie(oldCookie)).status, 200);

    const res = await admin(`/api/users/${target.id}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 200);

    assert.equal((await meWithCookie(oldCookie)).status, 401);
  });
});

describe("#327 Finding 7 -- logout stays single-device, by design", () => {
  test("a second, independently-logged-in session for the same account keeps working after the first logs out", async () => {
    const target = await createTarget();
    const { cookie: sessionA } = await loginRaw(target.email, PASSWORD);
    const { cookie: sessionB } = await loginRaw(target.email, PASSWORD);
    assert.equal((await meWithCookie(sessionA)).status, 200);
    assert.equal((await meWithCookie(sessionB)).status, 200);

    const base = await startServer();
    const logoutRes = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: sessionA },
    });
    assert.equal(logoutRes.status, 200);

    assert.equal(
      (await meWithCookie(sessionB)).status,
      200,
      "logging out of session A must not invalidate session B"
    );
  });
});
