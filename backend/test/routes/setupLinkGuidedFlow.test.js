// The new-account page (#590): a setup link proves the inbox, and the person then chooses how they
// will sign in. A password is followed by an authenticator app, a passkey stands alone, and either
// ends signed in with no extra sign-in step. A link never replaces a second factor someone already
// has, except for a passkey-only account (the lost-device case).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { generate } = require("otplib");
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { issueSetupToken } = require("../../src/utils/passwordSetup");
const { client, stopServer } = require("./helpers");

let anon;
const made = [];
const PASSWORD = "Guided-flow-pass-2026!";

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function makeUser(tag, extra = {}) {
  const user = await prisma.user.create({
    data: {
      email: `route-test-guided-${tag}@example.test`,
      passwordHash: null,
      role: "editor",
      active: true,
      authProvider: "local",
      firstName: "Dana",
      ...extra,
    },
  });
  made.push(user.id);
  return user;
}
const post = (path, body, headers) => anon(path, { method: "POST", body, headers });

before(async () => {
  anon = await client(null);
});

after(async () => {
  await prisma.userPasskey.deleteMany({ where: { userId: { in: made } } });
  await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: made } } });
  await prisma.passwordSetupToken.deleteMany({ where: { userId: { in: made } } });
  await prisma.auditEvent?.deleteMany?.({ where: { targetId: { in: made } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await stopServer();
});

describe("a new account's link: a password, then an authenticator app, then signed in", () => {
  test("the password step hands back an enrolment token and no session", async () => {
    const user = await makeUser("new");
    const { token } = await issueSetupToken(user);
    const info = await post("/api/auth/password-setup/validate", { token });
    assert.equal(info.body.hasSecondFactor, false);
    assert.equal(info.body.passwordAllowed, true);

    const done = await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.ok(done.body.setupToken, "an enrolment token, good for adding the second factor");
    assert.equal(cookieOf(done), "", "no session until the second factor is added");
  });

  test("adding the authenticator app signs them in and hands over recovery codes", async () => {
    const user = await makeUser("app");
    const { token } = await issueSetupToken(user);
    const done = await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    const bearer = { Authorization: `Bearer ${done.body.setupToken}` };
    const setup = await post("/api/auth/mfa/setup", undefined, bearer);
    assert.equal(setup.status, 200);
    const verified = await post(
      "/api/auth/mfa/verify-setup",
      { token: await generate({ secret: setup.body.secret }) },
      bearer
    );
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.ok(cookieOf(verified).includes("="), "signed in straight from the link");
    assert.ok(verified.body.recoveryCodes?.length > 0, "recovery codes are shown once");
    const me = await anon("/api/auth/me", { headers: { Cookie: cookieOf(verified) } });
    assert.equal(me.status, 200);
  });

  test("the link works once", async () => {
    const user = await makeUser("once");
    const { token } = await issueSetupToken(user);
    await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    const again = await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    assert.equal(again.status, 400);
  });
});

describe("a reset link for an account that already has two-factor", () => {
  test("changes the password but gives no session and no new enrolment: the second factor is met at sign-in", async () => {
    const user = await makeUser("reset", {
      passwordHash: await bcrypt.hash("Old-password-2026!", 4),
      mfaEnabled: true,
      mfaSecret: "stub",
    });
    const { token } = await issueSetupToken(user);
    const info = await post("/api/auth/password-setup/validate", { token });
    assert.equal(info.body.hasSecondFactor, true);
    const done = await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    assert.equal(done.status, 200);
    assert.equal(done.body.setupToken, undefined, "a link alone never starts a new enrolment");
    assert.equal(cookieOf(done), "");
    const login = await post("/api/auth/login", { email: user.email, password: PASSWORD });
    assert.equal(login.body.mfaRequired, true, "they are still asked for their second factor");
  });

  test("the passkey route refuses it", async () => {
    const user = await makeUser("reset-passkey", {
      passwordHash: await bcrypt.hash("Old-password-2026!", 4),
      mfaEnabled: true,
      mfaSecret: "stub",
    });
    const { token } = await issueSetupToken(user);
    const res = await post("/api/auth/password-setup/passkey", { token });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /already has two-factor/);
  });
});

describe("the passkey route", () => {
  test("spends the link and returns an enrolment token", async () => {
    const user = await makeUser("passkey");
    const { token } = await issueSetupToken(user);
    const res = await post("/api/auth/password-setup/passkey", { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.setupToken);
    const again = await post("/api/auth/password-setup/passkey", { token });
    assert.equal(again.status, 400, "the link is burned");
    // The enrolment token can start a passkey registration for this account, and only this one.
    const options = await post(
      "/api/auth/passkeys/register/options",
      {},
      {
        Authorization: `Bearer ${res.body.setupToken}`,
      }
    );
    assert.equal(options.status, 200, JSON.stringify(options.body));
  });

  test("an invalid link is refused with the generic message", async () => {
    const res = await post("/api/auth/password-setup/passkey", { token: "nope" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid or has expired/i);
  });
});

describe("the lost-device case: a passkey-only account", () => {
  async function passkeyOnly(tag) {
    const user = await makeUser(tag, { mfaEnabled: true });
    await prisma.userPasskey.create({
      data: {
        userId: user.id,
        credentialId: `guided-${tag}-credential`,
        publicKey: "AAAA",
        counter: 0,
        transports: [],
        label: "Lost phone",
      },
    });
    return user;
  }

  test("a new link through the passkey route clears the old passkeys first", async () => {
    const user = await passkeyOnly("lost-passkey");
    const { token } = await issueSetupToken(user);
    const res = await post("/api/auth/password-setup/passkey", { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 0);
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(row.mfaEnabled, false);
  });

  test("choosing a password instead also clears them, so the lost passkey is never asked for", async () => {
    const user = await passkeyOnly("lost-password");
    const { token } = await issueSetupToken(user);
    const info = await post("/api/auth/password-setup/validate", { token });
    assert.equal(info.body.hasSecondFactor, false, "no password, so the passkey was its whole sign-in");
    const done = await post("/api/auth/password-setup/complete", { token, password: PASSWORD });
    assert.equal(done.status, 200);
    assert.ok(done.body.setupToken, "goes on to add an authenticator app");
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 0);
  });
});
