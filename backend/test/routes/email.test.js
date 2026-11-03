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
    select: { postmarkServerToken: true, emailFromAddress: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { postmarkServerToken: null, emailFromAddress: null },
    create: { id: "singleton" },
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
    assert.deepEqual(res.body, { configured: false, fromAddress: null });
  });
});

describe("PUT /api/settings/email -- write-only token", () => {
  test("saving a token and from address never echoes the token back, and it's stored encrypted", async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { serverToken: "pm-test-token-abc123", fromAddress: "updates@example.org" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true, fromAddress: "updates@example.org" });

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
    assert.equal(res.body.configured, true);
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
});

// Same reasoning as aiExtraction.test.js's "the real key literal never
// appears in any response, anywhere" -- this is real, billable Postmark
// usage (and a real credential), so the leak guard is its own test, not
// trusted to the ordinary admin-gate/write-only-field tests above.
describe("the real token literal never appears in any response, anywhere", () => {
  const REAL_TOKEN = "pm-REAL-SECRET-should-never-leak-9f8e7d6c5b4a";

  before(async () => {
    const res = await admin("/api/settings/email", {
      method: "PUT",
      body: { serverToken: REAL_TOKEN, fromAddress: "updates@example.org" },
    });
    assert.equal(res.status, 200, "fixture setup: saving the token should succeed");
  });

  test("GET /api/settings (any logged-in role) never includes the token", async () => {
    for (const asUser of [admin, editor, viewer]) {
      const res = await asUser("/api/settings");
      assert.equal(res.status, 200);
      assert.ok(
        !JSON.stringify(res.body).includes(REAL_TOKEN),
        "the real token leaked into GET /api/settings"
      );
    }
  });

  test("GET /api/settings/email never includes the token", async () => {
    const res = await admin("/api/settings/email");
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_TOKEN),
      "the real token leaked into GET /api/settings/email"
    );
  });

  test("PUT /api/settings/email's own response never echoes the token back", async () => {
    const res = await admin("/api/settings/email", { method: "PUT", body: { serverToken: REAL_TOKEN } });
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_TOKEN),
      "the real token was echoed back in the PUT response"
    );
  });

  test("the row's stored value is never the plaintext token, only the encrypted form", async () => {
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { postmarkServerToken: true },
    });
    assert.notEqual(row.postmarkServerToken, REAL_TOKEN);
    assert.ok(row.postmarkServerToken.startsWith("v1:"));
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
