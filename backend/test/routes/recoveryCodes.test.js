// Recovery codes: ten one-time codes made when someone enrols an authenticator app, so a person who loses the
// phone can still get in. They show once at enrolment, work once each, share the wrong-code limit with the
// authenticator code, can be remade (which retires the old set), and go when the app is switched off or an
// admin resets two-factor. The clear-two-factor command is the way back for a sole admin.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const { generate, generateSecret } = require("otplib");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { CODE_COUNT, generateCode, normalizeCode, hashCode } = require("../../src/utils/recoveryCodes");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

const PASSWORD = "RecoveryCodeTest123!";
const EMAILS = {
  enrol: "route-test-recovery-enrol@example.test",
  use: "route-test-recovery-use@example.test",
  remake: "route-test-recovery-remake@example.test",
  sole: "route-test-recovery-sole@example.test",
  admin: "route-test-recovery-admin@example.test",
  target: "route-test-recovery-target@example.test",
};

let anon;
let original;
const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const as =
  (cookie) =>
  (p, options = {}) =>
    anon(p, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });
const login = (email) => anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });

async function makeUser(email, { enrolled = false, role = "editor" } = {}) {
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = {
    passwordHash,
    role,
    active: true,
    authProvider: "local",
    mfaEnabled: enrolled,
    mfaSecret: enrolled ? encryptField(secret) : null,
  };
  const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  return { user, secret };
}

// Sign-in as a not-yet-enrolled account: set up, confirm a code, and get the codes back.
async function enrol(email) {
  const first = await login(email);
  assert.ok(first.body.setupToken, "sent to enrolment");
  const bearer = { Authorization: `Bearer ${first.body.setupToken}` };
  const setup = await anon("/api/auth/mfa/setup", { method: "POST", headers: bearer });
  const verified = await anon("/api/auth/mfa/verify-setup", {
    method: "POST",
    headers: bearer,
    body: { token: await generate({ secret: setup.body.secret }) },
  });
  assert.equal(verified.status, 200);
  return { codes: verified.body.recoveryCodes, cookie: cookieOf(verified) };
}

// Gives an enrolled account a fresh known set of codes without going through enrolment.
async function giveCodes(userId) {
  const { issueRecoveryCodes } = require("../../src/utils/recoveryCodes");
  return issueRecoveryCodes(userId);
}

async function signInWithRecoveryCode(email, recoveryCode) {
  const first = await login(email);
  assert.ok(first.body.pendingToken);
  return anon("/api/auth/mfa/login-verify", {
    method: "POST",
    body: { pendingToken: first.body.pendingToken, recoveryCode },
  });
}

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true },
  });
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { requireTwoFactor: true },
    create: { id: "singleton", requireTwoFactor: true },
  });
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { requireTwoFactor: original?.requireTwoFactor ?? false },
  });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await removeTestUsers();
  await stopServer();
});

describe("the codes themselves", () => {
  test("look like abcde-fghjk, from an alphabet with no look-alikes", () => {
    for (let i = 0; i < 200; i++)
      assert.match(generateCode(), /^[2-9a-hjkmnp-tv-z]{5}-[2-9a-hjkmnp-tv-z]{5}$/);
  });

  test("typing them with spaces, capitals or no dash is the same code", () => {
    assert.equal(normalizeCode(" ABCDE-fghjk "), "abcdefghjk");
    assert.equal(hashCode("abcde-fghjk"), hashCode("ABCDE FGHJK"));
  });
});

describe("enrolment", () => {
  test("shows ten codes once, and stores only their hashes", async () => {
    const { user } = await makeUser(EMAILS.enrol);
    const { codes } = await enrol(EMAILS.enrol);
    assert.equal(codes.length, CODE_COUNT);
    assert.equal(new Set(codes).size, CODE_COUNT);
    const rows = await prisma.userRecoveryCode.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, CODE_COUNT);
    for (const row of rows) {
      assert.equal(row.usedAt, null);
      assert.ok(!codes.includes(row.codeHash), "no code is kept in plain text");
    }
  });
});

describe("signing in with a recovery code", () => {
  test("works once, tells how many remain, and the same code is then refused", async () => {
    const { user } = await makeUser(EMAILS.use, { enrolled: true });
    const codes = await giveCodes(user.id);
    const ok = await signInWithRecoveryCode(EMAILS.use, codes[0].toUpperCase().replace("-", " "));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.recoveryCodesRemaining, CODE_COUNT - 1);
    assert.equal(ok.body.user.recoveryCodesRemaining, CODE_COUNT - 1, "the account page can show it");
    assert.ok(cookieOf(ok), "a session is granted");

    const again = await signInWithRecoveryCode(EMAILS.use, codes[0]);
    assert.equal(again.status, 401);
    assert.match(again.body.error, /not valid or was already used/);
    const other = await signInWithRecoveryCode(EMAILS.use, codes[1]);
    assert.equal(other.status, 200);
  });

  test("a wrong code is refused", async () => {
    const { user } = await makeUser(EMAILS.use, { enrolled: true });
    await giveCodes(user.id);
    const res = await signInWithRecoveryCode(EMAILS.use, "aaaaa-aaaaa");
    assert.equal(res.status, 401);
  });

  test("another person's code does not work", async () => {
    const a = await makeUser(EMAILS.use, { enrolled: true });
    const b = await makeUser(EMAILS.remake, { enrolled: true });
    await giveCodes(a.user.id);
    const bCodes = await giveCodes(b.user.id);
    const res = await signInWithRecoveryCode(EMAILS.use, bCodes[0]);
    assert.equal(res.status, 401);
  });

  test("a spent code is recorded in the audit trail", async () => {
    const { user } = await makeUser(EMAILS.use, { enrolled: true });
    const codes = await giveCodes(user.id);
    const row = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...(row?.enabledFeatures || {}), auditTrail: true } },
    });
    try {
      const ok = await signInWithRecoveryCode(EMAILS.use, codes[2]);
      assert.equal(ok.status, 200);
      const entry = await prisma.auditLog.findFirst({
        where: { action: "auth.recovery_code_used", actorUserId: user.id },
      });
      assert.ok(entry, "the use is on the audit trail");
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enabledFeatures: row?.enabledFeatures ?? {} },
      });
    }
  });
});

describe("making a new set", () => {
  test("needs the password and retires every older code", async () => {
    const { user } = await makeUser(EMAILS.remake, { enrolled: true });
    const old = await giveCodes(user.id);
    const first = await login(EMAILS.remake);
    // Session for the account page: use an old code to get one.
    const signedIn = await anon("/api/auth/mfa/login-verify", {
      method: "POST",
      body: { pendingToken: first.body.pendingToken, recoveryCode: old[0] },
    });
    const cookie = cookieOf(signedIn);

    const noPassword = await as(cookie)("/api/auth/mfa/recovery-codes", { method: "POST", body: {} });
    assert.equal(noPassword.status, 400);
    const wrong = await as(cookie)("/api/auth/mfa/recovery-codes", {
      method: "POST",
      body: { password: "nope" },
    });
    assert.equal(wrong.status, 401);

    const res = await as(cookie)("/api/auth/mfa/recovery-codes", {
      method: "POST",
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.recoveryCodes.length, CODE_COUNT);
    const stale = await signInWithRecoveryCode(EMAILS.remake, old[1]);
    assert.equal(stale.status, 401, "an old code no longer works");
    const fresh = await signInWithRecoveryCode(EMAILS.remake, res.body.recoveryCodes[0]);
    assert.equal(fresh.status, 200);
  });

  test("is refused for an account with no authenticator app", async () => {
    await makeUser(EMAILS.enrol); // not enrolled
    const { user } = await makeUser(EMAILS.admin, { role: "admin" });
    assert.ok(user);
    // an account with no authenticator has no session to ask with under the requirement, so check the guard
    // directly with a session made by a one-off direct sign-in
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { requireTwoFactor: false } });
    const res = await login(EMAILS.admin);
    assert.equal(res.status, 200);
    const refused = await as(cookieOf(res))("/api/auth/mfa/recovery-codes", {
      method: "POST",
      body: { password: PASSWORD },
    });
    assert.equal(refused.status, 400);
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { requireTwoFactor: true } });
  });
});

describe("clearing two-factor", () => {
  test("an admin's reset removes the codes along with the secret", async () => {
    const admin = await makeUser(EMAILS.admin, { enrolled: true, role: "admin" });
    const target = await makeUser(EMAILS.target, { enrolled: true });
    await giveCodes(target.user.id);
    const first = await login(EMAILS.admin);
    const signed = await anon("/api/auth/mfa/login-verify", {
      method: "POST",
      body: { pendingToken: first.body.pendingToken, token: await generate({ secret: admin.secret }) },
    });
    const res = await as(cookieOf(signed))(`/api/users/${target.user.id}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(await prisma.userRecoveryCode.count({ where: { userId: target.user.id } }), 0);
  });

  test("the server command lets a sole admin back in and takes everything away", async () => {
    const { user } = await makeUser(EMAILS.sole, { enrolled: true, role: "admin" });
    await giveCodes(user.id);
    await prisma.userPasskey.create({
      data: {
        userId: user.id,
        credentialId: `cred-${Date.now()}`,
        publicKey: "x",
        transports: [],
        label: "phone",
      },
    });
    const before = (await prisma.user.findUnique({ where: { id: user.id } })).sessionVersion;

    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, "../../scripts/clear-two-factor.js"), EMAILS.sole.toUpperCase()],
      { env: process.env, encoding: "utf8" }
    );
    assert.match(out, /Two-factor cleared/);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(after.mfaEnabled, false);
    assert.equal(after.mfaSecret, null);
    assert.equal(after.sessionVersion, before + 1);
    assert.equal(await prisma.userRecoveryCode.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 0);

    const res = await login(EMAILS.sole);
    assert.ok(res.body.setupToken, "password sign-in goes straight to enrolment again");
  });

  test("the command refuses an unknown email and a missing argument", () => {
    const script = path.join(__dirname, "../../scripts/clear-two-factor.js");
    assert.throws(() =>
      execFileSync(process.execPath, [script, "nobody@example.test"], { env: process.env, stdio: "pipe" })
    );
    assert.throws(() => execFileSync(process.execPath, [script], { env: process.env, stdio: "pipe" }));
  });
});
