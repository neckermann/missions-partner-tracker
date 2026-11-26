// Church-wide passwordless sign-in. Covers when it can be turned on (working email, the admin
// has a passkey), that it ends password sign-in, that a passkey alone signs a person in (and a
// replay, wrong site or stranger's credential doesn't), that someone with no passkey gets an
// emailed one-time link and is then taken through adding one, that a link works once and
// expires, and that outbound email can't be switched off underneath it.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const { generateSecret } = require("otplib");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { issueSignInLink } = require("../../src/utils/passwordless");
const { client, stopServer } = require("./helpers");
const { createAuthenticator } = require("./softAuthenticator");

const PASSWORD = "PasswordlessTest123!";
const SITE = "https://church.example.test";
const RP_ID = "church.example.test";
const emails = [];
let anon;
let savedBase;
let original;

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
// Like a browser: keeps the latest session cookie a response sets (enrolling the first passkey
// re-issues it).
const as = (cookie) => {
  let current = cookie;
  return async (path, options = {}) => {
    const res = await anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: current } });
    const set = res.headers.getSetCookie();
    if (set.length) current = set.map((c) => c.split(";")[0]).join("; ");
    return res;
  };
};
const newAuthenticator = () => createAuthenticator({ rpID: RP_ID, origin: SITE });

async function makeUser(tag, extra = {}) {
  const email = `route-test-passwordless-${tag}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = { passwordHash, role: "editor", active: true, authProvider: "local", ...extra };
  return prisma.user.upsert({
    where: { email },
    update: { mfaEnabled: false, mfaSecret: null, ...data },
    create: { email, ...data },
  });
}
async function loginCookie(email) {
  const res = await anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return cookieOf(res);
}
async function addPasskey(who, authenticator, headers) {
  const opts = await who("/api/auth/passkeys/register/options", { method: "POST", headers });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  return who("/api/auth/passkeys/register/verify", {
    method: "POST",
    headers,
    body: {
      challengeToken: opts.body.challengeToken,
      response: authenticator.register(opts.body.options.challenge),
    },
  });
}
// A user with a passkey, plus the authenticator that holds it.
async function userWithPasskey(tag, extra = {}) {
  const user = await makeUser(tag, extra);
  const a = newAuthenticator();
  const cookie = await loginCookie(user.email);
  const enrolled = await addPasskey(as(cookie), a);
  assert.equal(enrolled.status, 200);
  // Enrolling the first passkey re-issues the session cookie.
  return { user, a, cookie: cookieOf(enrolled) };
}
async function passkeySignIn(a, assertOptions = {}) {
  const opts = await anon("/api/auth/passkeys/passwordless/options", { method: "POST" });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const response = a.assert(opts.body.options.challenge, assertOptions);
  const send = () =>
    anon("/api/auth/passkeys/passwordless/verify", {
      method: "POST",
      body: { challengeToken: opts.body.challengeToken, response },
    });
  return { send, opts, response };
}
const settings = (patch) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: patch,
    create: { id: "singleton", ...patch },
  });
const emailOn = (on) =>
  prisma.churchSettings
    .findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } })
    .then((s) =>
      settings({
        enabledFeatures: { ...(s?.enabledFeatures || {}), outboundEmail: on },
        postmarkServerToken: on ? encryptField("test-token") : null,
        emailFromAddress: on ? "church@example.test" : null,
      })
    );
const turnOn = (who) => who("/api/settings", { method: "PUT", body: { requirePasswordless: true } });
const turnOff = () => settings({ requirePasswordless: false });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  anon = await client(null);
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = SITE;
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await settings({ requirePasswordless: false, requireTwoFactor: false });
});

after(async () => {
  if (savedBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBase;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await settings({
    requirePasswordless: false,
    requireTwoFactor: original?.requireTwoFactor ?? false,
    enabledFeatures: original?.enabledFeatures ?? {},
    postmarkServerToken: original?.postmarkServerToken ?? null,
    emailFromAddress: original?.emailFromAddress ?? null,
  });
  await stopServer();
});

describe("turning it on", () => {
  test("needs working email and a passkey on the admin's own account, and says which is missing", async () => {
    const { cookie } = await userWithPasskey("admin-a", { role: "admin" });
    const noPasskeyAdmin = await makeUser("admin-b", { role: "admin" });
    const asNoPasskey = as(await loginCookie(noPasskeyAdmin.email));
    const asAdmin = as(cookie);

    await emailOn(false);
    const noEmail = await turnOn(asAdmin);
    assert.equal(noEmail.status, 400);
    assert.match(noEmail.body.error, /outbound email/);

    await emailOn(true);
    const noPass = await turnOn(asNoPasskey);
    assert.equal(noPass.status, 400);
    assert.match(noPass.body.error, /passkey/);

    const ok = await turnOn(asAdmin);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    try {
      const me = await asAdmin("/api/auth/me");
      assert.equal(me.body.user.passwordlessRequired, true);
      assert.equal(me.body.user.emailReady, true);
      assert.equal((await anon("/api/auth/setup-status")).body.passwordless, true);
    } finally {
      await turnOff();
    }
    assert.equal((await anon("/api/auth/setup-status")).body.passwordless, false);
  });

  test("outbound email can't be switched off while it is on", async () => {
    const { cookie } = await userWithPasskey("admin-email", { role: "admin" });
    await emailOn(true);
    assert.equal((await turnOn(as(cookie))).status, 200);
    try {
      const res = await as(cookie)("/api/settings", {
        method: "PUT",
        body: { enabledFeatures: { outboundEmail: false } },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /passwordless/);
    } finally {
      await turnOff();
    }
  });
});

describe("with it on", () => {
  test("password sign-in is refused for everyone, and the church-wide switch is off again afterwards", async () => {
    const user = await makeUser("nopassword");
    await settings({ requirePasswordless: true });
    try {
      const res = await anon("/api/auth/login", {
        method: "POST",
        body: { email: user.email, password: PASSWORD },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.passwordless, true);
    } finally {
      await turnOff();
    }
    assert.equal(
      (await anon("/api/auth/login", { method: "POST", body: { email: user.email, password: PASSWORD } }))
        .status,
      200
    );
  });

  test("a passkey alone signs a person in, with no email asked for", async () => {
    const { user, a } = await userWithPasskey("signin");
    await settings({ requirePasswordless: true });
    try {
      const attempt = await passkeySignIn(a);
      const res = await attempt.send();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.user.email, user.email);
      const cookie = cookieOf(res);
      assert.equal((await as(cookie)("/api/auth/me")).status, 200, "a real session");
      assert.ok((await prisma.userPasskey.findFirst({ where: { userId: user.id } })).lastUsedAt);
    } finally {
      await turnOff();
    }
  });

  test("a replayed assertion, another site's, an unknown credential and an inactive account are refused", async () => {
    const { user, a } = await userWithPasskey("refuse");
    const stranger = newAuthenticator();
    await settings({ requirePasswordless: true });
    try {
      const ok = await passkeySignIn(a);
      assert.equal((await ok.send()).status, 200);
      assert.equal((await ok.send()).status, 401, "the same assertion twice");
      assert.equal(
        (await (await passkeySignIn(a, { origin: "https://evil.example.test" })).send()).status,
        401
      );
      assert.equal(
        (await (await passkeySignIn(stranger)).send()).status,
        401,
        "a credential the server never saw"
      );
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      assert.equal((await (await passkeySignIn(a)).send()).status, 401, "a deactivated account");
    } finally {
      await turnOff();
    }
  });

  test("passkey-only sign-in is off by default; allowing it opens it, but never the emailed link", async () => {
    assert.equal((await anon("/api/auth/passkeys/passwordless/options", { method: "POST" })).status, 404);
    assert.equal((await anon("/api/auth/setup-status")).body.passkeySignIn, false);
    await settings({ allowPasskeySignIn: true });
    try {
      assert.equal((await anon("/api/auth/passkeys/passwordless/options", { method: "POST" })).status, 200);
      assert.equal((await anon("/api/auth/setup-status")).body.passkeySignIn, true);
      assert.equal((await anon("/api/auth/setup-status")).body.passwordless, false);
    } finally {
      await settings({ allowPasskeySignIn: false });
    }
    assert.equal(
      (await anon("/api/auth/passwordless/email-link", { method: "POST", body: { email: "x@y.z" } })).status,
      404
    );
    assert.equal(
      (await anon("/api/auth/passwordless/link/redeem", { method: "POST", body: { token: "x" } })).status,
      404
    );
  });
});

describe("the emailed link", () => {
  test("is requested with one reply for every address, and issued only to an account with no passkey", async () => {
    const noKey = await makeUser("link-nokey");
    const { user: hasKey } = await userWithPasskey("link-haskey");
    await emailOn(true);
    await settings({ requirePasswordless: true });
    try {
      const replies = [];
      for (const email of [noKey.email, hasKey.email, "nobody-here@example.test"]) {
        const res = await anon("/api/auth/passwordless/email-link", { method: "POST", body: { email } });
        assert.equal(res.status, 200);
        replies.push(res.body);
      }
      assert.deepEqual(replies[0], replies[1]);
      assert.deepEqual(replies[1], replies[2]);
      await pause(300); // the link is issued after the reply goes out
      assert.equal(await prisma.signInLinkToken.count({ where: { userId: noKey.id } }), 1);
      assert.equal(await prisma.signInLinkToken.count({ where: { userId: hasKey.id } }), 0);
    } finally {
      await turnOff();
    }
  });

  test("signs in once, then leads through adding a passkey, and works only once", async () => {
    const user = await makeUser("link-flow");
    await emailOn(true);
    await settings({ requirePasswordless: true });
    try {
      const { token } = await issueSignInLink(user);
      const redeemed = await anon("/api/auth/passwordless/link/redeem", { method: "POST", body: { token } });
      assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
      assert.equal(redeemed.body.mfaSetupRequired, true, "no session yet: sent to add a passkey");
      assert.ok(redeemed.body.setupToken);
      assert.equal(cookieOf(redeemed), "");

      const again = await anon("/api/auth/passwordless/link/redeem", { method: "POST", body: { token } });
      assert.equal(again.status, 400, "a link works once");

      const bearer = { Authorization: `Bearer ${redeemed.body.setupToken}` };
      const withToken = (path, options = {}) =>
        anon(path, { ...options, headers: { ...bearer, ...(options.headers || {}) } });
      const done = await addPasskey(withToken, newAuthenticator());
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.user.email, user.email);
      assert.equal((await as(cookieOf(done))("/api/auth/me")).status, 200);
    } finally {
      await turnOff();
    }
  });

  test("an expired link, a made-up one and one for a deactivated account are refused", async () => {
    const user = await makeUser("link-bad");
    await emailOn(true);
    await settings({ requirePasswordless: true });
    try {
      const { token } = await issueSignInLink(user);
      await prisma.signInLinkToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const redeem = (t) =>
        anon("/api/auth/passwordless/link/redeem", { method: "POST", body: { token: t } });
      assert.equal((await redeem(token)).status, 400);
      assert.equal((await redeem("not-a-token")).status, 400);
      const fresh = await issueSignInLink(user);
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      assert.equal((await redeem(fresh.token)).status, 400);
    } finally {
      await turnOff();
    }
  });

  test("an account with only an authenticator app is still asked for its code after the link", async () => {
    const user = await makeUser("link-totp", { mfaEnabled: true, mfaSecret: encryptField(generateSecret()) });
    await emailOn(true);
    await settings({ requirePasswordless: true });
    try {
      const { token } = await issueSignInLink(user);
      const res = await anon("/api/auth/passwordless/link/redeem", { method: "POST", body: { token } });
      assert.equal(res.status, 200);
      assert.equal(res.body.mfaRequired, true);
      assert.deepEqual(res.body.methods, { authenticatorApp: true, passkey: false });
    } finally {
      await turnOff();
    }
  });
});
