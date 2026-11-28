const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// "Email (Sending) is on" is not "this site can send email": until a mail account and From address are
// saved, every place that would email must act as if email is off (use the copy-link fallback, never
// promise an email), and admins get one notice. The fetch mock proves no mail is ever attempted.
const realFetch = global.fetch;
let postmarkCalls = 0;
global.fetch = (url, options) => {
  if (String(url).startsWith("https://api.postmarkapp.com")) {
    postmarkCalls++;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ MessageID: "x" }) });
  }
  return realFetch(url, options);
};

const EMAIL = "email-not-ready-test@example.test";
let admin;
let anon;
let original;

async function setSettings(data) {
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  anon = await client();
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, postmarkServerToken: true, emailFromAddress: true },
  });
  // Switched on, but no mail account and no From address.
  await setSettings({
    enabledFeatures: { outboundEmail: true, publicDirectory: true, publicPrayerDigest: true },
    postmarkServerToken: null,
    emailFromAddress: null,
  });
});

after(async () => {
  global.fetch = realFetch;
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  if (original) await prisma.churchSettings.update({ where: { id: "singleton" }, data: original });
  await removeTestUsers();
  await stopServer();
});

describe("email on but not finished setting up", () => {
  test("Add User hands the admin a copy-link instead of dead-ending", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: EMAIL, role: "viewer", sendWelcomeEmail: true },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.welcomeEmail.manualSetupUrl, "a setup link to copy");
    assert.equal(res.body.welcomeEmail.error, undefined);
    assert.equal(postmarkCalls, 0);
  });

  test("the public Subscribe form does not promise an email", async () => {
    const res = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email: "nobody@example.test", allPartners: true },
    });
    assert.equal(res.status, 503);
    assert.doesNotMatch(String(res.body.error), /check your email/i);
    assert.equal(postmarkCalls, 0);
  });

  test("admins see one 'Email isn't finished setting up' notice, and editors do not", async () => {
    const res = await admin("/api/notifications/summary");
    const item = res.body.categories.find((c) => c.key === "emailNotFinished");
    assert.ok(item, "the category is listed for admins");
    assert.equal(item.count, 1);
    const editor = await client("editor");
    const editorRes = await editor("/api/notifications/summary");
    assert.ok(!editorRes.body.categories.some((c) => c.key === "emailNotFinished"));
  });

  test("once an account and sender are saved, the notice is gone and sending is allowed again", async () => {
    await setSettings({
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
    });
    const res = await admin("/api/notifications/summary");
    const item = res.body.categories.find((c) => c.key === "emailNotFinished");
    assert.equal(item?.count ?? 0, 0);
    const sub = await anon("/api/public/subscribe", {
      method: "POST",
      body: { email: "nobody2@example.test", allPartners: true },
    });
    assert.equal(sub.status, 200);
    await prisma.publicSubscriber.deleteMany({
      where: { email: { in: ["nobody@example.test", "nobody2@example.test"] } },
    });
  });
});
