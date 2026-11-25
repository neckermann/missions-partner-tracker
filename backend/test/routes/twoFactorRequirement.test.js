// The church-wide two-factor requirement: one switch, ChurchSettings.requireTwoFactor, for
// every account whatever its role. Off: sign-in needs no second factor. On: an account that
// has not enrolled is sent to enrolment at sign-in and gets no session, a session it opened
// before the switch stops working, and nobody can switch two-factor off for themselves.
// Turning it on needs the person doing it to be enrolled (so it can't lock them out) and is
// refused on the public demo. No rule is specific to one kind of account: a guest is treated
// like an editor.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const { generate, generateSecret } = require("otplib");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { issueSetupToken } = require("../../src/utils/passwordSetup");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
  TEST_PASSWORD,
  TEST_USERS,
} = require("./helpers");

const PASSWORD = "TwoFactorTest123!";
const EMAILS = {
  admin: "route-test-2fa-admin@example.test",
  guest: "route-test-2fa-guest@example.test",
  loser: "route-test-2fa-lost-device@example.test",
  disabler: "route-test-2fa-disabler@example.test",
  welcome: "route-test-2fa-welcome@example.test",
};

let anon;
let original;
let adminCookie; // an enrolled admin, signed in once (a TOTP code can be used once per 30s step)

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const as =
  (cookie) =>
  (path, options = {}) =>
    anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });

async function login(email, password = PASSWORD) {
  const res = await anon("/api/auth/login", { method: "POST", body: { email, password } });
  return { ...res, cookie: cookieOf(res) };
}

// An account that has already enrolled: a real secret, so a real code can sign it in.
async function makeEnrolled(email, role = "editor") {
  const secret = generateSecret();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, active: true, mfaEnabled: true, mfaSecret: encryptField(secret) },
    create: {
      email,
      passwordHash,
      role,
      active: true,
      authProvider: "local",
      mfaEnabled: true,
      mfaSecret: encryptField(secret),
    },
  });
  return { user, secret };
}

async function signInWithCode(email, secret) {
  const first = await login(email);
  assert.equal(first.status, 200);
  assert.ok(first.body.pendingToken, "an enrolled account is asked for a code");
  const res = await anon("/api/auth/mfa/login-verify", {
    method: "POST",
    body: { pendingToken: first.body.pendingToken, token: await generate({ secret }) },
  });
  assert.equal(res.status, 200);
  return cookieOf(res);
}

// What a person does when sent to enrolment: set up, confirm a code, and get the session back.
async function enrol(setupToken) {
  const bearer = { Authorization: `Bearer ${setupToken}` };
  const setup = await anon("/api/auth/mfa/setup", { method: "POST", headers: bearer });
  assert.equal(setup.status, 200);
  const verified = await anon("/api/auth/mfa/verify-setup", {
    method: "POST",
    headers: bearer,
    body: { token: await generate({ secret: setup.body.secret }) },
  });
  assert.equal(verified.status, 200);
  return cookieOf(verified);
}

const setRequirement = (value) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { requireTwoFactor: value },
    create: { id: "singleton", requireTwoFactor: value },
  });

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true },
  });
  await setRequirement(false);

  // A plain guest with a trip grant, to show a guest is treated like everyone else.
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const guest = await prisma.user.upsert({
    where: { email: EMAILS.guest },
    update: { passwordHash, role: "guest", active: true, mfaEnabled: false, mfaSecret: null },
    create: { email: EMAILS.guest, passwordHash, role: "guest", authProvider: "local", active: true },
  });
  const partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} two-factor guest` },
  });
  const trip = await prisma.trip.create({ data: { partnerId: partner.id, status: "planning" } });
  await prisma.tripAccess.deleteMany({ where: { userId: guest.id } });
  await prisma.tripAccess.create({ data: { userId: guest.id, tripId: trip.id } });

  const admin = await makeEnrolled(EMAILS.admin, "admin");
  adminCookie = await signInWithCode(EMAILS.admin, admin.secret);
});

after(async () => {
  await setRequirement(original?.requireTwoFactor ?? false);
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await removeFixturePartners(); // cascades the trip
  await removeTestUsers();
  delete process.env.DEMO_RESET_TOKEN;
  await stopServer();
});

describe("two-factor requirement: off", () => {
  test("is off by default and sign-in is unchanged: password alone", async () => {
    const res = await login(TEST_USERS.editor.email, TEST_PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.setupToken, undefined);
    assert.ok(res.cookie, "a session cookie");
    const me = await as(res.cookie)("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.twoFactorRequired, false);
  });

  test("a guest signs in with a password alone, like anyone else (no rule is specific to a guest)", async () => {
    const res = await login(EMAILS.guest);
    assert.equal(res.status, 200);
    assert.equal(res.body.setupToken, undefined);
    assert.ok(res.cookie);
  });

  test("switching two-factor off is the person's own choice while it isn't required", async () => {
    const { secret } = await makeEnrolled(EMAILS.disabler);
    const cookie = await signInWithCode(EMAILS.disabler, secret);
    const res = await as(cookie)("/api/auth/mfa/disable", { method: "POST", body: { password: PASSWORD } });
    assert.equal(res.status, 200);
  });
});

describe("two-factor requirement: turning it on", () => {
  test("is refused unless the person turning it on has enrolled, so it can't lock them out", async () => {
    const unenrolled = await client("admin"); // the shared test admin has not enrolled
    const res = await unenrolled("/api/settings", { method: "PUT", body: { requireTwoFactor: true } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Set up two-factor on your own account first/);
    const row = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    assert.equal(row?.requireTwoFactor ?? false, false);
  });

  test("is refused on the public demo, which cannot enrol its shared logins", async () => {
    process.env.DEMO_RESET_TOKEN = "demo-token-for-this-test";
    try {
      const res = await as(adminCookie)("/api/settings", { method: "PUT", body: { requireTwoFactor: true } });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /public demo/);
    } finally {
      delete process.env.DEMO_RESET_TOKEN;
    }
  });

  test("works for an enrolled admin, and is recorded in the audit log", async () => {
    const res = await as(adminCookie)("/api/settings", { method: "PUT", body: { requireTwoFactor: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.requireTwoFactor, true);
    const entry = await prisma.auditLog.findFirst({
      where: { action: "settings.updated" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(JSON.stringify(entry?.details).includes("requireTwoFactor"), "the change is in the audit log");
    await setRequirement(false);
  });
});

describe("two-factor requirement: on", () => {
  before(() => setRequirement(true));
  after(() => setRequirement(false));

  test("an account that has not enrolled is sent to enrolment and gets no session", async () => {
    const res = await login(TEST_USERS.editor.email, TEST_PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaSetupRequired, true);
    assert.ok(res.body.setupToken, "a setup token, good only for enrolment");
    assert.equal(res.cookie, "", "no session until they enrol");
    // The setup token is not a session: it opens nothing else.
    const sneaky = await anon("/api/partners", {
      headers: { Authorization: `Bearer ${res.body.setupToken}` },
    });
    assert.equal(sneaky.status, 401);
  });

  test("finishing enrolment gives them the session, and it works", async () => {
    const first = await login(TEST_USERS.editor.email, TEST_PASSWORD);
    const cookie = await enrol(first.body.setupToken);
    const me = await as(cookie)("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.twoFactorRequired, true);
    // Leave the shared editor as found: not enrolled.
    await prisma.user.update({
      where: { email: TEST_USERS.editor.email },
      data: { mfaEnabled: false, mfaSecret: null, mfaLastTimeStep: null },
    });
  });

  test("a guest is treated exactly like an editor", async () => {
    const res = await login(EMAILS.guest);
    assert.equal(res.body.mfaSetupRequired, true);
    assert.ok(res.body.setupToken);
    assert.equal(res.cookie, "");
  });

  test("an enrolled account signs in with its code as before", async () => {
    const { secret } = await makeEnrolled(EMAILS.loser);
    const cookie = await signInWithCode(EMAILS.loser, secret);
    assert.equal((await as(cookie)("/api/auth/me")).status, 200);
  });

  test("nobody can switch it off for themselves while it is required", async () => {
    const res = await as(adminCookie)("/api/auth/mfa/disable", {
      method: "POST",
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /requires two-factor/);
    const row = await prisma.user.findUnique({ where: { email: EMAILS.admin } });
    assert.equal(row.mfaEnabled, true);
  });

  test("an admin's reset of a lost authenticator sends that person through enrolment again", async () => {
    await makeEnrolled(EMAILS.loser);
    const target = await prisma.user.findUnique({ where: { email: EMAILS.loser } });
    const reset = await as(adminCookie)(`/api/users/${target.id}/mfa/reset`, { method: "POST" });
    assert.equal(reset.status, 200);
    const res = await login(EMAILS.loser);
    assert.equal(res.body.mfaSetupRequired, true, "back to enrolment, not a password-only session");
    assert.equal(res.cookie, "");
  });

  test("the welcome link reports that two-factor is required, for an account with no flag of its own", async () => {
    const user = await prisma.user.upsert({
      where: { email: EMAILS.welcome },
      update: { passwordHash: null, role: "viewer", active: true, mfaSetupRequired: false },
      create: {
        email: EMAILS.welcome,
        passwordHash: null,
        role: "viewer",
        active: true,
        authProvider: "local",
      },
    });
    const { token } = await issueSetupToken(user);
    const res = await anon("/api/auth/password-setup/validate", { method: "POST", body: { token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaRequired, true);
  });

  test("the Users & access report shows who still has to enrol", async () => {
    const res = await as(adminCookie)("/api/reports/users-access");
    assert.equal(res.status, 200);
    const editor = res.body.rows.find((r) => r.name === TEST_USERS.editor.email);
    assert.equal(editor?.mfa, "Required, not set up");
  });
});

describe("two-factor requirement: on a demo deployment", () => {
  before(() => setRequirement(true));
  after(() => {
    delete process.env.DEMO_RESET_TOKEN;
    return setRequirement(false);
  });

  test("a stored requirement is ignored: a password alone signs in, no enrolment", async () => {
    process.env.DEMO_RESET_TOKEN = "demo-token-for-this-test";
    const res = await login(TEST_USERS.editor.email, TEST_PASSWORD);
    assert.equal(res.status, 200);
    assert.notEqual(res.body.mfaSetupRequired, true);
    assert.ok(res.cookie, "a session");
    const me = await as(res.cookie)("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.twoFactorRequired, false);
  });
});

describe("two-factor requirement: a session open when it is turned on", () => {
  test("stops working at once for an account that has not enrolled, and works again if it is turned off", async () => {
    await setRequirement(false);
    const signedIn = await login(TEST_USERS.editor.email, TEST_PASSWORD);
    assert.equal((await as(signedIn.cookie)("/api/auth/me")).status, 200);

    await setRequirement(true);
    const during = await as(signedIn.cookie)("/api/auth/me");
    assert.equal(during.status, 401);
    assert.match(during.body.error, /Two-factor authentication is required/);

    await setRequirement(false);
    assert.equal(
      (await as(signedIn.cookie)("/api/auth/me")).status,
      200,
      "the session itself was not destroyed"
    );
  });

  test("an enrolled admin's session is unaffected", async () => {
    await setRequirement(true);
    try {
      assert.equal((await as(adminCookie)("/api/auth/me")).status, 200);
    } finally {
      await setRequirement(false);
    }
  });
});
