// #601: authenticator-app setup (/mfa/setup, /mfa/verify-setup) and switching it off (/mfa/disable), each tested on
// its own, including the ways they refuse: no session, a half-finished sign-in, an expired setup token, a wrong
// code, and no (or the wrong) password. twoFactorRequirement.test.js and recoveryCodes.test.js touch these routes
// in passing; this file is where their behaviour is pinned down.
// This file makes more than ten calls to /mfa/verify-setup and /mfa/disable in one run, past the limit on those
// (securityHardening.test.js tests the limit at its real value), so it raises it for its own server.
process.env.SENSITIVE_AUTH_MAX = "1000";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generate, generateSecret } = require("otplib");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { issueRecoveryCodes } = require("../../src/utils/recoveryCodes");
const { signToken, SESSION_COOKIE_NAME } = require("../../src/utils/jwt");
const { client, stopServer } = require("./helpers");

const PASSWORD = "MfaSetupDisable123!";
const tag = (name) => `route-test-mfa-${name}@example.test`;
const created = [];
let anon;
let originalRequirement;

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const post = (path, body, headers) => anon(path, { method: "POST", body, headers });
const as =
  (cookie) =>
  (path, options = {}) =>
    anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function makeUser(name, { enrolled = false } = {}) {
  const secret = generateSecret();
  const email = tag(name);
  const data = {
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: "editor",
    active: true,
    authProvider: "local",
    mfaEnabled: enrolled,
    mfaSecret: enrolled ? encryptField(secret) : null,
    mfaLastTimeStep: null,
  };
  const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  created.push(user.id);
  if (enrolled) await issueRecoveryCodes(user.id);
  return { user, secret, email };
}

// A signed-in session for the account, going through the second step when it has an app.
async function session(account) {
  const first = await post("/api/auth/login", { email: account.email, password: PASSWORD });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  if (!first.body.mfaRequired) return cookieOf(first);
  const second = await post("/api/auth/mfa/login-verify", {
    pendingToken: first.body.pendingToken,
    token: await generate({ secret: account.secret }),
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  return cookieOf(second);
}

const setRequirement = (value) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { requireTwoFactor: value },
    create: { id: "singleton", requireTwoFactor: value },
  });

before(async () => {
  anon = await client(null);
  originalRequirement = (await prisma.churchSettings.findUnique({ where: { id: "singleton" } }))
    ?.requireTwoFactor;
  await setRequirement(false); // so a password alone gives a session, and disabling is allowed
});

after(async () => {
  await setRequirement(originalRequirement ?? false);
  await prisma.userPasskey.deleteMany({ where: { userId: { in: created } } });
  await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await stopServer();
});

describe("POST /api/auth/mfa/setup", () => {
  test("needs a session", async () => {
    assert.equal((await post("/api/auth/mfa/setup")).status, 401);
  });

  test("a half-finished sign-in (the code step still to do) is not a session", async () => {
    const enrolled = await makeUser("setup-pending", { enrolled: true });
    const first = await post("/api/auth/login", { email: enrolled.email, password: PASSWORD });
    assert.ok(first.body.pendingToken);
    const res = await post("/api/auth/mfa/setup", undefined, bearer(first.body.pendingToken));
    assert.equal(res.status, 401);
  });

  test("a garbage or expired setup token is refused", async () => {
    const { user } = await makeUser("setup-expired");
    assert.equal((await post("/api/auth/mfa/setup", undefined, bearer("not-a-token"))).status, 401);
    const expired = jwt.sign({ id: user.id, mfaSetup: true }, process.env.SESSION_SECRET, { expiresIn: -10 });
    assert.equal((await post("/api/auth/mfa/setup", undefined, bearer(expired))).status, 401);
  });

  test("hands back a secret and a QR code, and leaves nothing switched on until a code is confirmed", async () => {
    const account = await makeUser("setup-ok");
    const cookie = await session(account);
    const res = await as(cookie)("/api/auth/mfa/setup", { method: "POST" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.secret && res.body.secret.length >= 16);
    assert.match(res.body.qrCode, /^data:image\/png;base64,/);
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaEnabled, false, "an abandoned attempt leaves nothing half-configured");
    assert.ok(row.mfaSecret, "the secret is stored for the confirmation step");
    assert.notEqual(row.mfaSecret, res.body.secret, "stored encrypted, never as the raw secret");
  });

  test("is refused once an app is already on", async () => {
    const account = await makeUser("setup-twice", { enrolled: true });
    const cookie = await session(account);
    const res = await as(cookie)("/api/auth/mfa/setup", { method: "POST" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /already enabled/);
  });
});

describe("POST /api/auth/mfa/verify-setup", () => {
  test("needs a code", async () => {
    const cookie = await session(await makeUser("verify-nocode"));
    const res = await as(cookie)("/api/auth/mfa/verify-setup", { method: "POST", body: {} });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Code is required/);
  });

  test("with no setup in progress there is nothing to confirm", async () => {
    const cookie = await session(await makeUser("verify-nosetup"));
    const res = await as(cookie)("/api/auth/mfa/verify-setup", { method: "POST", body: { token: "123456" } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /No MFA setup in progress/);
  });

  test("a wrong code is refused and nothing is switched on", async () => {
    const account = await makeUser("verify-wrong");
    const who = as(await session(account));
    await who("/api/auth/mfa/setup", { method: "POST" });
    const res = await who("/api/auth/mfa/verify-setup", { method: "POST", body: { token: "000000" } });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /Invalid code/);
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaEnabled, false);
  });

  test("the right code switches it on, hands over recovery codes once, and ends other sessions", async () => {
    const account = await makeUser("verify-ok");
    const oldCookie = await session(account);
    const who = as(oldCookie);
    const setup = await who("/api/auth/mfa/setup", { method: "POST" });
    const verified = await who("/api/auth/mfa/verify-setup", {
      method: "POST",
      body: { token: await generate({ secret: setup.body.secret }) },
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.recoveryCodes.length, 10);
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaEnabled, true);
    assert.equal(row.mfaSetupRequired, false);
    assert.ok(row.mfaLastTimeStep, "the code's time step is remembered so it cannot be replayed");
    assert.equal(await prisma.userRecoveryCode.count({ where: { userId: account.user.id } }), 10);

    // The session that confirmed it carries on; the one opened before enrolment does not.
    assert.equal((await as(cookieOf(verified))("/api/auth/me")).status, 200);
    assert.equal((await as(oldCookie)("/api/auth/me")).status, 401);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.mfa_enabled", actorUserId: account.user.id },
    });
    assert.ok(audit, "recorded in the audit log");
  });

  test("the same code cannot be used to confirm twice", async () => {
    const account = await makeUser("verify-replay");
    const who = as(await session(account));
    const setup = await who("/api/auth/mfa/setup", { method: "POST" });
    const token = await generate({ secret: setup.body.secret });
    const first = await who("/api/auth/mfa/verify-setup", { method: "POST", body: { token } });
    assert.equal(first.status, 200);
    // Once on, there is no setup in progress, so a replay finds nothing to confirm (the session that confirmed it
    // is the one that carries on; the one opened before enrolment has ended).
    const again = await as(cookieOf(first))("/api/auth/mfa/verify-setup", {
      method: "POST",
      body: { token },
    });
    assert.equal(again.status, 400);
    assert.equal((await who("/api/auth/mfa/verify-setup", { method: "POST", body: { token } })).status, 401);
  });
});

describe("POST /api/auth/mfa/disable", () => {
  test("needs a session", async () => {
    assert.equal((await post("/api/auth/mfa/disable", { password: PASSWORD })).status, 401);
  });

  test("is refused while the church requires two-factor", async () => {
    const account = await makeUser("disable-required", { enrolled: true });
    const who = as(await session(account));
    await setRequirement(true);
    try {
      const res = await who("/api/auth/mfa/disable", { method: "POST", body: { password: PASSWORD } });
      assert.equal(res.status, 403);
      assert.match(res.body.error, /requires two-factor/);
      assert.equal((await prisma.user.findUnique({ where: { id: account.user.id } })).mfaEnabled, true);
    } finally {
      await setRequirement(false);
    }
  });

  test("needs the current password, and the wrong one changes nothing", async () => {
    const account = await makeUser("disable-password", { enrolled: true });
    const who = as(await session(account));
    const none = await who("/api/auth/mfa/disable", { method: "POST", body: {} });
    assert.equal(none.status, 400);
    assert.match(none.body.error, /Current password is required/);
    const wrong = await who("/api/auth/mfa/disable", {
      method: "POST",
      body: { password: "not-the-password" },
    });
    assert.equal(wrong.status, 401, JSON.stringify(wrong.body));
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaEnabled, true);
    assert.ok(row.mfaSecret);
    assert.equal(await prisma.userRecoveryCode.count({ where: { userId: account.user.id } }), 10);
  });

  test("with the password it switches the app off, retires the recovery codes and ends other sessions", async () => {
    const account = await makeUser("disable-ok", { enrolled: true });
    const keep = await session(account);
    // A second session for the same account, as another device would hold (built directly: a second sign-in in the
    // same half minute would be refused as a replayed code).
    const other = `${SESSION_COOKIE_NAME}=${signToken(await prisma.user.findUnique({ where: { id: account.user.id } }))}`;
    assert.equal((await as(other)("/api/auth/me")).status, 200, "the second session works before");
    const res = await as(keep)("/api/auth/mfa/disable", { method: "POST", body: { password: PASSWORD } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaEnabled, false);
    assert.equal(row.mfaSecret, null);
    assert.equal(await prisma.userRecoveryCode.count({ where: { userId: account.user.id } }), 0);
    // This tab's cookie is re-issued so it keeps working; any other session stops.
    assert.equal((await as(cookieOf(res))("/api/auth/me")).status, 200);
    assert.equal((await as(other)("/api/auth/me")).status, 401, "the other session stops");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.mfa_disabled", actorUserId: account.user.id },
    });
    assert.ok(audit, "recorded in the audit log");
  });

  test("a passkey keeps two-factor on: only the app goes", async () => {
    const account = await makeUser("disable-passkey", { enrolled: true });
    await prisma.userPasskey.create({
      data: {
        userId: account.user.id,
        credentialId: "mfa-disable-credential",
        publicKey: "AAAA",
        counter: 0,
        transports: [],
        label: "Phone",
      },
    });
    const who = as(await session(account));
    const res = await who("/api/auth/mfa/disable", { method: "POST", body: { password: PASSWORD } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.user.findUnique({ where: { id: account.user.id } });
    assert.equal(row.mfaSecret, null);
    assert.equal(row.mfaEnabled, true, "still on, with the passkey");
  });
});
