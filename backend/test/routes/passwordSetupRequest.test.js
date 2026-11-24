// Regression coverage for POST /api/auth/password-setup/request (the
// self-service "send me a new setup link" action). #345 email review:
// this route previously called sendWelcomeEmail with no explicit
// outboundEmail check first -- every other call site (users.js's own
// POST /:id/setup-link and the welcome-email-on-create path) checks
// isFeatureEnabled(settings?.enabledFeatures, "outboundEmail") before
// attempting the send. This route "worked" by accident instead: with
// outboundEmail off, sendWelcomeEmail throws its own "not configured"
// error internally, and the route's own catch (deliberately swallowing
// everything, so the generic response never reveals whether an account
// exists) hid that too. Same end-user-visible behavior either way, but
// relying on an incidental throw-and-swallow instead of an explicit
// check is exactly the fragility this suite exists to pin down.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer } = require("./helpers");

const FROM_DOMAIN = "route-test.passwordsetup.example";

// Same mock-the-whole-domain technique tripParticipants.test.js/
// dispatchOrchestrator.test.js already use for Postmark -- monkey-patch
// global.fetch, matching only the Postmark host, so this suite can tell
// whether a send was actually attempted (not just whether one failed).
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
let originalSettings;
let user;

before(async () => {
  anon = await client(null);

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, postmarkServerToken: true, emailFromAddress: true },
  });
  // Postmark fully configured (so a send would actually go out if the
  // route attempted one), but outboundEmail itself left off -- the exact
  // configuration that used to rely on sendWelcomeEmail's own throw.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: { outboundEmail: false },
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
    },
    create: {
      id: "singleton",
      enabledFeatures: { outboundEmail: false },
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
    },
  });

  user = await prisma.user.create({
    data: {
      email: `passwordless-${Date.now()}@${FROM_DOMAIN}`,
      role: "editor",
      active: true,
      authProvider: "local",
      passwordHash: null, // a real account still waiting to set its password
    },
  });
});

after(async () => {
  global.fetch = realFetch;
  await prisma.user.deleteMany({ where: { id: user.id } });
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await stopServer();
});

describe("POST /api/auth/password-setup/request -- outboundEmail off", () => {
  test("says to ask an administrator (nobody is left waiting for an email), and never attempts to send", async () => {
    postmarkCalls = [];
    const res = await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: user.email },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.emailOff, true);
    assert.match(res.body.message, /ask your church administrator/i);

    // The response above fires before the email attempt even starts (see
    // routes/auth.js's own comment on why), so give it a moment to not
    // happen rather than asserting immediately against a race.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(postmarkCalls.length, 0, "no Postmark send should have been attempted");
  });

  test("the same reply comes back for an email with no account at all, so it reveals nothing about accounts", async () => {
    postmarkCalls = [];
    const real = await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: user.email },
    });
    const res = await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: `nobody-${Date.now()}@${FROM_DOMAIN}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, real.body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(postmarkCalls.length, 0);
  });
});

describe("POST /api/auth/password-setup/request -- outboundEmail on", () => {
  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true } },
    });
  });
  after(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: false } },
    });
  });

  test("the same generic reply for an account waiting to be set up and for an unknown address", async () => {
    const real = await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: user.email },
    });
    const unknown = await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: `nobody-${Date.now()}@${FROM_DOMAIN}` },
    });
    assert.equal(real.status, 200);
    assert.deepEqual(real.body, unknown.body);
    assert.equal(real.body.emailOff, undefined);
    assert.match(real.body.message, /if that email has an account/i);
    // The waiting account's link is sent after the reply; let it finish so it can't be
    // counted by the next test.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("a link is sent to a waiting account, and nothing is sent for an unknown address", async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    postmarkCalls = [];
    await anon("/api/auth/password-setup/request", {
      method: "POST",
      body: { email: `nobody-${Date.now()}@${FROM_DOMAIN}` },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(postmarkCalls.length, 0, "no account, so nothing is sent");

    await anon("/api/auth/password-setup/request", { method: "POST", body: { email: user.email } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(postmarkCalls.length, 1, "the waiting account is sent its link");
  });
});
