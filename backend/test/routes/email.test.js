const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// Intercepts only calls to api.postmarkapp.com -- everything else (the test
// harness's own requests to the local server in helpers.js) passes through
// untouched, since both share the same global fetch. Same technique as
// groupme.test.js's mockGroupMe.
const realFetch = global.fetch;
let postmarkResponder = null;
function mockPostmark(responder) {
  postmarkResponder = responder;
}
function unmockPostmark() {
  postmarkResponder = null;
}
global.fetch = (url, options) => {
  if (postmarkResponder && String(url).startsWith("https://api.postmarkapp.com")) {
    return postmarkResponder(url, options);
  }
  return realFetch(url, options);
};
function postmarkJson(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let admin;
let editor;
let viewer;
let unauthenticated;
let originalSettings;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      postmarkServerToken: true,
      emailFromAddress: true,
      inboundEmailWebhookUsername: true,
      inboundEmailWebhookPassword: true,
      enabledFeatures: true,
    },
  });
  // Clean slate -- these tests assume nothing is configured yet. email:
  // true (sending on, receiving off) since most of these tests exercise
  // what happens once sending is on -- the "independent gates" and
  // "gated by feature flag" blocks below flip flags deliberately for
  // their own cases.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      postmarkServerToken: null,
      emailFromAddress: null,
      inboundEmailWebhookUsername: null,
      inboundEmailWebhookPassword: null,
      enabledFeatures: { outboundEmail: true },
    },
    create: { id: "singleton", enabledFeatures: { outboundEmail: true } },
  });
});

after(async () => {
  unmockPostmark();
  global.fetch = realFetch;
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/email -- admin gate", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/email")).status, 401);
  });

  test("editor is rejected -- this feature lives behind the admin gate specifically, not just its writes", async () => {
    assert.equal((await editor("/api/settings/email")).status, 403);
    assert.equal(
      (await editor("/api/settings/email", { method: "PUT", body: { serverToken: "x" } })).status,
      403
    );
  });

  test("admin sees unconfigured", async () => {
    const res = await admin("/api/settings/email");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      sendEnabled: true,
      outboundConfigured: false,
      fromAddress: null,
      receiveEnabled: false,
      inboundConfigured: false,
      webhookUsername: null,
      webhookPath: "/api/inbound-email/postmark",
      // Trips (#252) -- purely informational, not a credential.
      inboundEmailAddress: null,
    });
  });
});

describe("PUT /api/settings/email -- write-only credentials, both directions", () => {
  test("saving a token and from address never echoes the token back, and it's stored encrypted", async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { serverToken: "pm-test-token-abc123", fromAddress: "updates@example.org" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.outboundConfigured, true);
    assert.equal(res.body.fromAddress, "updates@example.org");

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { postmarkServerToken: true },
    });
    assert.ok(row.postmarkServerToken.startsWith("v1:"), "token is stored encrypted, not plaintext");
    assert.notEqual(row.postmarkServerToken, "pm-test-token-abc123");
  });

  test("saving nothing leaves the stored token untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { postmarkServerToken: true },
    });
    const res = await admin("/api/settings/email", { method: "PUT", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.outboundConfigured, true);
    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { postmarkServerToken: true },
    });
    assert.equal(after.postmarkServerToken, before.postmarkServerToken);
  });

  test("an invalid from address is rejected", async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { fromAddress: "not-an-email" },
    });
    assert.equal(res.status, 400);
  });

  test("saving a webhook username/password never echoes the password back, and it's stored encrypted", async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { webhookUsername: "hookuser", webhookPassword: "hook-pass-123" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.inboundConfigured, true);
    assert.equal(res.body.webhookUsername, "hookuser");
    assert.ok(!("webhookPassword" in res.body));

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { inboundEmailWebhookPassword: true },
    });
    assert.ok(
      row.inboundEmailWebhookPassword.startsWith("v1:"),
      "password is stored encrypted, not plaintext"
    );
  });

  test("sendEnabled/receiveEnabled merge into enabledFeatures without clobbering other flags", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, groupme: true } },
    });

    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { receiveEnabled: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.sendEnabled, true);
    assert.equal(res.body.receiveEnabled, true);

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    assert.deepEqual(row.enabledFeatures, { outboundEmail: true, groupme: true, inboundEmail: true });

    // Restore the describe-block baseline for tests that run after this one.
    await admin("/api/settings/email", { method: "PUT", body: { receiveEnabled: false } });
  });
});

// Sending and receiving are independently gated -- proving the shared
// settings page is reachable with only one of the two on, in either
// direction, is the concrete test that they don't depend on each other.
describe("sending and receiving are independently reachable", () => {
  test("reachable with only sending on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, inboundEmail: false } },
    });
    assert.equal((await admin("/api/settings/email")).status, 200);
  });

  test("reachable with only receiving on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: false, inboundEmail: true } },
    });
    assert.equal((await admin("/api/settings/email")).status, 200);

    // Restore the describe-block baseline for tests that run after this one.
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, inboundEmail: false } },
    });
  });

  test("POST /email/test checks sending's own flag, not receiving's -- 404 with only receiving on", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: false, inboundEmail: true } },
    });
    try {
      assert.equal((await admin("/api/settings/email/test", { method: "POST" })).status, 404);
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enabledFeatures: { outboundEmail: true, inboundEmail: false } },
      });
    }
  });
});

// Same reasoning as aiExtraction.test.js's "the real key literal never
// appears in any response, anywhere" -- these are real, billable/sensitive
// credentials, so the leak guard is its own test, not trusted to the
// ordinary admin-gate/write-only-field tests above.
describe("the real credential literals never appear in any response, anywhere", () => {
  const REAL_TOKEN = "pm-REAL-SECRET-should-never-leak-9f8e7d6c5b4a";
  const REAL_PASSWORD = "REAL-SECRET-webhook-password-should-never-leak-9f8e7d";

  before(async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: {
        serverToken: REAL_TOKEN,
        fromAddress: "updates@example.org",
        webhookUsername: "hookuser",
        webhookPassword: REAL_PASSWORD,
      },
    });
    assert.equal(res.status, 200, "fixture setup: saving credentials should succeed");
  });

  test("GET /api/settings (any logged-in role) never includes either credential", async () => {
    for (const asUser of [admin, editor, viewer]) {
      const res = await asUser("/api/settings");
      assert.equal(res.status, 200);
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes(REAL_TOKEN), "the real server token leaked into GET /api/settings");
      assert.ok(!body.includes(REAL_PASSWORD), "the real webhook password leaked into GET /api/settings");
    }
  });

  test("GET /api/settings/email never includes either credential", async () => {
    const res = await admin("/api/settings/email");
    assert.equal(res.status, 200);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(REAL_TOKEN), "the real server token leaked into GET /api/settings/email");
    assert.ok(!body.includes(REAL_PASSWORD), "the real webhook password leaked into GET /api/settings/email");
  });

  test("PUT /api/settings/email's own response never echoes either credential back", async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { serverToken: REAL_TOKEN, webhookPassword: REAL_PASSWORD },
    });
    assert.equal(res.status, 200);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(REAL_TOKEN), "the real server token was echoed back in the PUT response");
    assert.ok(!body.includes(REAL_PASSWORD), "the real webhook password was echoed back in the PUT response");
  });

  test("the row's stored values are never the plaintext credentials, only the encrypted form", async () => {
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { postmarkServerToken: true, inboundEmailWebhookPassword: true },
    });
    assert.notEqual(row.postmarkServerToken, REAL_TOKEN);
    assert.ok(row.postmarkServerToken.startsWith("v1:"));
    assert.notEqual(row.inboundEmailWebhookPassword, REAL_PASSWORD);
    assert.ok(row.inboundEmailWebhookPassword.startsWith("v1:"));
  });
});

describe("POST /api/settings/email/test", () => {
  before(async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { serverToken: "pm-test-token", fromAddress: "updates@example.org" },
    });
    assert.equal(res.status, 200);
  });

  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/email/test", { method: "POST" })).status, 401);
  });

  test("editor is rejected", async () => {
    assert.equal((await editor("/api/settings/email/test", { method: "POST" })).status, 403);
  });

  test("a successful Postmark send reports success", async () => {
    mockPostmark(async () =>
      postmarkJson(200, { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" })
    );
    try {
      const res = await admin("/api/settings/email/test", { method: "POST" });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { sent: true });
    } finally {
      unmockPostmark();
    }
  });

  test("a Postmark-side failure surfaces a clear error, not a generic 500", async () => {
    mockPostmark(async () => postmarkJson(422, { ErrorCode: 300, Message: "Invalid email request" }));
    try {
      const res = await admin("/api/settings/email/test", { method: "POST" });
      assert.equal(res.status, 502);
      assert.ok(res.body.error, "expected a readable error message");
    } finally {
      unmockPostmark();
    }
  });

  test("400s with a clear message when nothing is configured yet", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { postmarkServerToken: null, emailFromAddress: null },
    });
    const res = await admin("/api/settings/email/test", { method: "POST" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes("Email isn't configured"));
  });
});

// Unlike GroupMe/Joshua Project/AI Extraction (whose settings routes stay
// reachable while their feature is off, so an admin can configure them
// before flipping the switch), Email's settings route is gated by the
// feature flag the same way a real content feature's routes are -- see
// the same reasoning in routes/settings.js's comment on GET /email. It
// takes BOTH directions being off to 404 here, since GET/PUT /email is
// reachable if either is on (see the "independently reachable" block
// above) -- this block is specifically the all-off case.
describe("email settings routes are gated by the feature flag", () => {
  test("GET/PUT /email 404 with both directions off; POST /email/test 404s on sending alone", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: false, inboundEmail: false } },
    });
    try {
      assert.equal((await admin("/api/settings/email")).status, 404);
      assert.equal(
        (await admin("/api/settings/email", { method: "PUT", body: { fromAddress: "a@example.org" } }))
          .status,
        404
      );
      assert.equal((await admin("/api/settings/email/test", { method: "POST" })).status, 404);
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enabledFeatures: { outboundEmail: true, inboundEmail: false } },
      });
    }
  });
});
