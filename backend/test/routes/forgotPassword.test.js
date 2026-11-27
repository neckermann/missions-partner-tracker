// "Forgot your password?" on the sign-in page: the self-service link also serves an account
// that already has a password. The same generic reply for everyone, one email every 15 seconds per
// account, a one-hour link, every other session ended when it is used, never on a demo, never
// while passwordless sign-in is on.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer } = require("./helpers");

const DOMAIN = "route-test.forgot.example";
const OLD = "OldPassword123!";
const NEW = "BrandNewPassword456!";

const realFetch = global.fetch;
let postmarkCalls = [];
global.fetch = (url, options) => {
  if (String(url).startsWith("https://api.postmarkapp.com")) {
    postmarkCalls.push({ url, options });
    const body = { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  return realFetch(url, options);
};

let anon;
let original;
let savedBase;
const emails = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = (patch) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: patch,
    create: { id: "singleton", ...patch },
  });

async function makeUser(tag, extra = {}) {
  const email = `${tag}-${Date.now()}@${DOMAIN}`;
  emails.push(email);
  return prisma.user.create({
    data: {
      email,
      role: "editor",
      active: true,
      authProvider: "local",
      passwordHash: await bcrypt.hash(OLD, 4),
      ...extra,
    },
  });
}
const request = (email) => anon("/api/auth/password-setup/request", { method: "POST", body: { email } });
const login = (email, password) => anon("/api/auth/login", { method: "POST", body: { email, password } });
const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
// The reset link in the last email sent: /set-password?token=...
function tokenFromLastEmail() {
  const last = postmarkCalls[postmarkCalls.length - 1];
  const body = JSON.parse(last.options.body);
  const m = String(body.HtmlBody || body.TextBody).match(/set-password\?token=([A-Za-z0-9_%-]+)/);
  assert.ok(m, "the email carries a set-password link");
  return decodeURIComponent(m[1]);
}

before(async () => {
  anon = await client(null);
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://church.example.test";
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await settings({
    enabledFeatures: { ...(original?.enabledFeatures || {}), outboundEmail: true },
    postmarkServerToken: encryptField("pm-test-token"),
    emailFromAddress: "updates@example.test",
    requirePasswordless: false,
    requireTwoFactor: false,
  });
});

after(async () => {
  global.fetch = realFetch;
  if (savedBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBase;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await settings({
    enabledFeatures: original?.enabledFeatures ?? {},
    postmarkServerToken: original?.postmarkServerToken ?? null,
    emailFromAddress: original?.emailFromAddress ?? null,
    requirePasswordless: original?.requirePasswordless ?? false,
    requireTwoFactor: original?.requireTwoFactor ?? false,
  });
  await stopServer();
});

describe("asking for a reset link", () => {
  test("an account with a password is emailed a one-hour link, once every 15 seconds, and the reply gives nothing away", async () => {
    const user = await makeUser("reset");
    postmarkCalls = [];
    const real = await request(user.email);
    const unknown = await request(`nobody-${Date.now()}@${DOMAIN}`);
    assert.equal(real.status, 200);
    assert.deepEqual(real.body, unknown.body);
    await wait(500);
    assert.equal(postmarkCalls.length, 1, "only the real account is emailed");
    assert.equal(JSON.parse(postmarkCalls[0].options.body).To, user.email);

    const row = await prisma.passwordSetupToken.findFirst({ where: { userId: user.id, usedAt: null } });
    const ms = row.expiresAt.getTime() - row.createdAt.getTime();
    assert.ok(ms <= 61 * 60 * 1000, "a reset link lasts an hour, not days");

    await request(user.email);
    await wait(400);
    assert.equal(postmarkCalls.length, 1, "a second request within the minute sends nothing");
  });

  test("an account still waiting to choose a password gets the usual setup email", async () => {
    const waiting = await makeUser("waiting", { passwordHash: null });
    postmarkCalls = [];
    await request(waiting.email);
    await wait(500);
    assert.equal(postmarkCalls.length, 1);
    const row = await prisma.passwordSetupToken.findFirst({ where: { userId: waiting.id } });
    assert.ok(
      row.expiresAt.getTime() - row.createdAt.getTime() > 24 * 60 * 60 * 1000,
      "setup links last days"
    );
  });

  test("nothing is sent for a deactivated account, a demo, or while passwordless sign-in is on", async () => {
    const inactive = await makeUser("inactive", { active: false });
    const normal = await makeUser("modes");
    postmarkCalls = [];
    await request(inactive.email);
    await wait(300);
    assert.equal(postmarkCalls.length, 0, "deactivated");

    process.env.DEMO_RESET_TOKEN = "test-demo-token";
    try {
      await request(normal.email);
      await wait(300);
      assert.equal(postmarkCalls.length, 0, "demo");
    } finally {
      delete process.env.DEMO_RESET_TOKEN;
    }

    await settings({ requirePasswordless: true });
    try {
      await request(normal.email);
      await wait(300);
      assert.equal(postmarkCalls.length, 0, "passwordless");
    } finally {
      await settings({ requirePasswordless: false });
    }
  });
});

describe("choosing the new password", () => {
  test("changes the password, ends the sessions already open, and is audited as a reset", async () => {
    const user = await makeUser("choose");
    const before = await login(user.email, OLD);
    assert.equal(before.status, 200);
    const oldCookie = cookieOf(before);
    assert.equal((await anon("/api/auth/me", { headers: { Cookie: oldCookie } })).status, 200);

    postmarkCalls = [];
    await request(user.email);
    await wait(500);
    const token = tokenFromLastEmail();

    const info = await anon("/api/auth/password-setup/validate", { method: "POST", body: { token } });
    assert.equal(info.body.reset, true);
    const done = await anon("/api/auth/password-setup/complete", {
      method: "POST",
      body: { token, password: NEW },
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));

    assert.equal((await login(user.email, OLD)).status, 401);
    assert.equal((await login(user.email, NEW)).status, 200);
    assert.equal(
      (await anon("/api/auth/me", { headers: { Cookie: oldCookie } })).status,
      401,
      "the session opened with the old password is ended"
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.password_reset", actorEmail: user.email },
    });
    assert.ok(audit, "recorded as a reset");

    const again = await anon("/api/auth/password-setup/complete", {
      method: "POST",
      body: { token, password: OLD },
    });
    assert.equal(again.status, 400, "the link works once");
  });

  test("an enrolled second factor is still asked for at the next sign-in", async () => {
    const user = await makeUser("mfa", { mfaEnabled: true, mfaSecret: "stub" });
    postmarkCalls = [];
    await request(user.email);
    await wait(500);
    const token = tokenFromLastEmail();
    await anon("/api/auth/password-setup/complete", { method: "POST", body: { token, password: NEW } });
    const res = await login(user.email, NEW);
    assert.equal(res.body.mfaRequired, true, "a reset does not skip two-factor");
    assert.equal(cookieOf(res), "", "no session yet");
  });
});

describe("the sign-in page learns whether to offer it", () => {
  test("only with working email, a password to reset, and not on a demo", async () => {
    assert.equal((await anon("/api/auth/setup-status")).body.passwordReset, true);

    await settings({ requirePasswordless: true });
    assert.equal((await anon("/api/auth/setup-status")).body.passwordReset, false, "passwordless");
    await settings({ requirePasswordless: false });

    process.env.DEMO_RESET_TOKEN = "test-demo-token";
    try {
      assert.equal((await anon("/api/auth/setup-status")).body.passwordReset, false, "demo");
    } finally {
      delete process.env.DEMO_RESET_TOKEN;
    }

    await settings({ enabledFeatures: { outboundEmail: false } });
    assert.equal((await anon("/api/auth/setup-status")).body.passwordReset, false, "email off");
  });
});
