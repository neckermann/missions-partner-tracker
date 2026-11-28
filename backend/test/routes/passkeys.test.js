// Passkeys as a second sign-in factor. A software authenticator (softAuthenticator.js)
// produces real WebAuthn messages, so registration and sign-in run the real verification:
// adding one, signing in with it, a replayed or wrongly-signed assertion, a response for
// another site, the limit of five, removing one (and not the last while two-factor is
// required), the admin reset, and forced enrolment finishing with a passkey instead of a code.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");
const { createAuthenticator } = require("./softAuthenticator");

const PASSWORD = "PasskeyTest123!";
const SITE = "https://church.example.test";
const RP_ID = "church.example.test";
const emails = [];
let anon;
let admin;
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

async function makeUser(tag, extra = {}) {
  const email = `route-test-passkey-${tag}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = { passwordHash, role: "editor", active: true, authProvider: "local", ...extra };
  return prisma.user.upsert({
    where: { email },
    update: { mfaEnabled: false, mfaSecret: null, ...data },
    create: { email, ...data },
  });
}
const login = async (email) => {
  const res = await anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  return { ...res, cookie: cookieOf(res) };
};
const setRequirement = (value) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { requireTwoFactor: value },
    create: { id: "singleton", requireTwoFactor: value },
  });

// Adds a passkey through the real endpoints. `who` is a function carrying a session or a setup token.
async function addPasskey(who, authenticator, label) {
  const opts = await who("/api/auth/passkeys/register/options", { method: "POST" });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  return who("/api/auth/passkeys/register/verify", {
    method: "POST",
    body: {
      challengeToken: opts.body.challengeToken,
      response: authenticator.register(opts.body.options.challenge),
      label,
    },
  });
}
const newAuthenticator = () => createAuthenticator({ rpID: RP_ID, origin: SITE });

// The second step of sign-in with a passkey; `tamper` lets a test break one part.
async function signInWithPasskey(pendingToken, authenticator, assertOptions = {}) {
  const opts = await anon("/api/auth/passkeys/login/options", { method: "POST", body: { pendingToken } });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const response = authenticator.assert(opts.body.options.challenge, assertOptions);
  return {
    opts,
    response,
    send: () =>
      anon("/api/auth/passkeys/login/verify", {
        method: "POST",
        body: { pendingToken, challengeToken: opts.body.challengeToken, response },
      }),
  };
}

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  admin = await client("admin");
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = SITE;
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true },
  });
  await setRequirement(false);
});

after(async () => {
  if (savedBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBase;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { requireTwoFactor: original?.requireTwoFactor ?? false },
  });
  await removeTestUsers();
  await stopServer();
});

describe("adding a passkey", () => {
  test("stores the public key, turns two-factor on, and lists it", async () => {
    const user = await makeUser("add");
    const { cookie } = await login(user.email);
    const who = as(cookie);
    const res = await addPasskey(who, newAuthenticator(), "My laptop");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await prisma.userPasskey.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, "My laptop");
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled, true);
    const list = await who("/api/auth/passkeys");
    assert.equal(list.body.passkeys.length, 1);
    assert.equal(list.body.passkeys[0].label, "My laptop");
    assert.equal(list.body.passkeys[0].publicKey, undefined, "key material is never sent back");
    const me = await who("/api/auth/me");
    assert.equal(me.body.user.passkeyCount, 1);
    assert.equal(me.body.user.authenticatorApp, false);
  });

  test("refuses a response for another site, a spent or foreign challenge, and a sixth passkey", async () => {
    const user = await makeUser("reject");
    const { cookie } = await login(user.email);
    const who = as(cookie);

    const opts = await who("/api/auth/passkeys/register/options", { method: "POST" });
    const wrongSite = createAuthenticator({ rpID: RP_ID, origin: "https://evil.example.test" });
    const bad = await who("/api/auth/passkeys/register/verify", {
      method: "POST",
      body: {
        challengeToken: opts.body.challengeToken,
        response: wrongSite.register(opts.body.options.challenge),
      },
    });
    assert.equal(bad.status, 400, "a response from another origin");

    const opts2 = await who("/api/auth/passkeys/register/options", { method: "POST" });
    const a = newAuthenticator();
    const body = {
      challengeToken: opts2.body.challengeToken,
      response: a.register(opts2.body.options.challenge),
    };
    assert.equal((await who("/api/auth/passkeys/register/verify", { method: "POST", body })).status, 200);
    assert.equal(
      (await who("/api/auth/passkeys/register/verify", { method: "POST", body })).status,
      400,
      "a challenge can be used once"
    );

    for (let i = 0; i < 4; i++) assert.equal((await addPasskey(who, newAuthenticator())).status, 200);
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 5);
    assert.equal((await who("/api/auth/passkeys/register/options", { method: "POST" })).status, 409);
  });

  test("requires a signed-in person", async () => {
    assert.equal((await anon("/api/auth/passkeys/register/options", { method: "POST" })).status, 401);
    assert.equal((await anon("/api/auth/passkeys")).status, 401);
  });
});

describe("signing in with a passkey", () => {
  test("is offered after the password, and completes the sign-in", async () => {
    const user = await makeUser("signin");
    const first = await login(user.email);
    const a = newAuthenticator();
    await addPasskey(as(first.cookie), a);

    const second = await login(user.email);
    assert.equal(second.body.mfaRequired, true);
    assert.deepEqual(second.body.methods, { authenticatorApp: false, passkey: true });
    assert.equal(second.cookie, "", "no session yet");

    const attempt = await signInWithPasskey(second.body.pendingToken, a);
    const res = await attempt.send();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.email, user.email);
    assert.ok(cookieOf(res).includes("="), "a session cookie is set");
    const row = await prisma.userPasskey.findFirst({ where: { userId: user.id } });
    assert.ok(row.lastUsedAt);
    assert.equal(row.counter, 1);
  });

  test("a replayed assertion, a stale counter, another site's, or another person's pending token is refused", async () => {
    const user = await makeUser("replay");
    const other = await makeUser("replay-other");
    const a = newAuthenticator();
    await addPasskey(as((await login(user.email)).cookie), a);

    const ok = await signInWithPasskey((await login(user.email)).body.pendingToken, a);
    assert.equal((await ok.send()).status, 200);
    assert.equal((await ok.send()).status, 401, "the same assertion twice");

    // A fresh challenge but the counter went backwards: a cloned authenticator.
    const stale = await signInWithPasskey((await login(user.email)).body.pendingToken, a, {
      counterValue: 1,
    });
    assert.equal((await stale.send()).status, 401);

    const wrongSite = await signInWithPasskey((await login(user.email)).body.pendingToken, a, {
      origin: "https://evil.example.test",
    });
    assert.equal((await wrongSite.send()).status, 401);

    // The right passkey presented under someone else's sign-in.
    await addPasskey(as((await login(other.email)).cookie), newAuthenticator());
    const theirs = await login(other.email);
    const opts = await anon("/api/auth/passkeys/login/options", {
      method: "POST",
      body: { pendingToken: theirs.body.pendingToken },
    });
    const res = await anon("/api/auth/passkeys/login/verify", {
      method: "POST",
      body: {
        pendingToken: theirs.body.pendingToken,
        challengeToken: opts.body.challengeToken,
        response: a.assert(opts.body.options.challenge, { counterValue: 50 }),
      },
    });
    assert.equal(res.status, 401);
  });

  test("a registration challenge cannot be spent as a sign-in one, and no pending token means no options", async () => {
    const user = await makeUser("purpose");
    const a = newAuthenticator();
    const { cookie } = await login(user.email);
    const who = as(cookie); // keeps the cookie the enrolment re-issues
    await addPasskey(who, a);
    const reg = await who("/api/auth/passkeys/register/options", { method: "POST" });
    const pending = (await login(user.email)).body.pendingToken;
    const res = await anon("/api/auth/passkeys/login/verify", {
      method: "POST",
      body: {
        pendingToken: pending,
        challengeToken: reg.body.challengeToken,
        response: a.assert(reg.body.options.challenge),
      },
    });
    assert.equal(res.status, 401);
    assert.equal(
      (await anon("/api/auth/passkeys/login/options", { method: "POST", body: { pendingToken: "nope" } }))
        .status,
      401
    );
  });

  test("an account with no passkey gets no options", async () => {
    const user = await makeUser("none");
    const { pendingToken } = (
      await (async () => {
        const { generateSecret } = require("otplib");
        const { encryptField } = require("../../src/utils/crypto");
        await prisma.user.update({
          where: { id: user.id },
          data: { mfaEnabled: true, mfaSecret: encryptField(generateSecret()) },
        });
        return login(user.email);
      })()
    ).body;
    assert.deepEqual((await login(user.email)).body.methods, { authenticatorApp: true, passkey: false });
    assert.equal(
      (await anon("/api/auth/passkeys/login/options", { method: "POST", body: { pendingToken } })).status,
      401
    );
  });
});

describe("removing a passkey", () => {
  test("needs the password, and turns two-factor off when it was the last factor", async () => {
    const user = await makeUser("remove");
    const { cookie } = await login(user.email);
    const who = as(cookie);
    await addPasskey(who, newAuthenticator(), "One");
    await addPasskey(who, newAuthenticator(), "Two");
    const [one, two] = (await who("/api/auth/passkeys")).body.passkeys;

    assert.equal((await who(`/api/auth/passkeys/${one.id}`, { method: "DELETE", body: {} })).status, 400);
    assert.equal(
      (await who(`/api/auth/passkeys/${one.id}`, { method: "DELETE", body: { password: "wrong" } })).status,
      401
    );
    assert.equal(
      (await who(`/api/auth/passkeys/${one.id}`, { method: "DELETE", body: { password: PASSWORD } })).status,
      200
    );
    assert.equal(
      (await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled,
      true,
      "one is still left"
    );

    assert.equal(
      (await who(`/api/auth/passkeys/${two.id}`, { method: "DELETE", body: { password: PASSWORD } })).status,
      200
    );
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled, false);
  });

  test("cannot remove the last factor while the church requires two-factor, and not someone else's", async () => {
    const user = await makeUser("required");
    const { cookie } = await login(user.email);
    const who = as(cookie);
    await addPasskey(who, newAuthenticator());
    const [only] = (await who("/api/auth/passkeys")).body.passkeys;
    await setRequirement(true);
    try {
      // Signed in before the requirement; their session is already enrolled.
      const res = await who(`/api/auth/passkeys/${only.id}`, {
        method: "DELETE",
        body: { password: PASSWORD },
      });
      assert.equal(res.status, 403);
      assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 1);
    } finally {
      await setRequirement(false);
    }

    const stranger = await makeUser("stranger");
    const asStranger = as((await login(stranger.email)).cookie);
    assert.equal(
      (await asStranger(`/api/auth/passkeys/${only.id}`, { method: "DELETE", body: { password: PASSWORD } }))
        .status,
      404
    );
  });

  test("turning off the authenticator app keeps two-factor on while a passkey remains", async () => {
    const user = await makeUser("keepon");
    const { generateSecret } = require("otplib");
    const { encryptField } = require("../../src/utils/crypto");
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecret: encryptField(generateSecret()) },
    });
    // Signed in with a session that predates enrolment, via the admin-free path: add a passkey row directly.
    const a = newAuthenticator();
    const pre = await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    const { cookie } = await login(pre.email);
    const who = as(cookie);
    await addPasskey(who, a);
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptField(generateSecret()) } });
    const res = await who("/api/auth/mfa/disable", { method: "POST", body: { password: PASSWORD } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(after.mfaEnabled, true);
    assert.equal(after.mfaSecret, null);
  });
});

describe("admin reset and forced enrolment", () => {
  test("an admin's two-factor reset clears the person's passkeys", async () => {
    const user = await makeUser("reset");
    await addPasskey(as((await login(user.email)).cookie), newAuthenticator());
    const res = await admin(`/api/users/${user.id}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 0);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled, false);
  });

  test("a person sent to enrolment can finish with a passkey and gets a session", async () => {
    const user = await makeUser("forced");
    await setRequirement(true);
    try {
      const first = await login(user.email);
      assert.equal(first.body.mfaSetupRequired, true);
      const bearer = { Authorization: `Bearer ${first.body.setupToken}` };
      const withToken = (path, options = {}) =>
        anon(path, { ...options, headers: { ...bearer, ...(options.headers || {}) } });
      const res = await addPasskey(withToken, newAuthenticator(), "Phone");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.user.email, user.email);
      const cookie = cookieOf(res);
      assert.ok(cookie.includes("="), "signed in");
      assert.equal((await as(cookie)("/api/auth/me")).status, 200);
      assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled, true);
    } finally {
      await setRequirement(false);
    }
  });
});

describe("the public demo", () => {
  test("refuses a visitor adding a passkey to the shared login, and never asks for one at sign-in", async () => {
    const user = await makeUser("demo");
    process.env.DEMO_RESET_TOKEN = "test-demo-token";
    try {
      const first = await login(user.email);
      const who = as(first.cookie);
      // A published, shared login: a passkey added to it would let a visitor sign in as that account (#595).
      assert.equal((await who("/api/auth/passkeys/register/options", { method: "POST" })).status, 403);
      const list = await who("/api/auth/passkeys");
      assert.equal(list.body.demo, true);
      assert.equal(list.body.passkeys.length, 0);

      // The login is shared, so someone else signing in is not asked for a passkey either.
      const second = await login(user.email);
      assert.equal(second.body.mfaRequired, undefined);
      assert.ok(second.cookie.includes("="), "a normal session");
      assert.equal((await as(first.cookie)("/api/auth/me")).status, 200);
    } finally {
      delete process.env.DEMO_RESET_TOKEN;
    }
    assert.equal((await as((await login(user.email)).cookie)("/api/auth/passkeys")).body.demo, false);
  });
});
