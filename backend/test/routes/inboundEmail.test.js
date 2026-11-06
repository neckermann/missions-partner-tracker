const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const WEBHOOK_USER = "route-test-webhook-user";
const WEBHOOK_PASS = "route-test-webhook-pass-123";
// Isolates every synthetic sender address these tests use, so cleanup can
// find and remove the InboundEmail rows they create without touching
// anything a real webhook call (or another test file) might have left
// behind.
const FROM_DOMAIN = "route-test.inboundemail.example";

function basicAuthHeader(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

function postmarkPayload(overrides = {}) {
  return {
    FromFull: { Email: overrides.from || `sender@${FROM_DOMAIN}` },
    Subject: "Update from the field",
    RawEmail: "From: sender@example.org\r\nSubject: Update from the field\r\n\r\nHello!",
    MessageID: `msg-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

let admin;
let editor;
let viewer;
let unauthenticated;
let originalSettings;

async function createPartner(overrides = {}) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} ${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  unauthenticated = await client();

  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { inboundEmailWebhookUsername: true, inboundEmailWebhookPassword: true, enabledFeatures: true },
  });
  // Clean slate -- feature on, real webhook credentials configured, same as
  // email.test.js's own baseline for the outbound side.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { inboundEmailWebhookUsername: null, inboundEmailWebhookPassword: null, enabledFeatures: {} },
    create: { id: "singleton", enabledFeatures: {} },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { inboundEmail: true } },
  });
  const res = await admin("/api/settings/email", {
    method: "PUT",
    body: { webhookUsername: WEBHOOK_USER, webhookPassword: WEBHOOK_PASS },
  });
  assert.equal(
    res.status,
    200,
    `fixture setup: saving webhook credentials should succeed: ${JSON.stringify(res.body)}`
  );
});

after(async () => {
  await prisma.inboundEmail.deleteMany({ where: { fromAddress: { contains: FROM_DOMAIN } } });
  await removeFixturePartners();
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/inbound-email/postmark -- webhook auth", () => {
  test("no Authorization header is rejected", async () => {
    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      body: postmarkPayload(),
    });
    assert.equal(res.status, 401);
  });

  test("wrong credentials are rejected", async () => {
    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, "not-the-password") },
      body: postmarkPayload(),
    });
    assert.equal(res.status, 401);
  });

  test("right credentials but the feature is off: 404, not 401 -- confirms auth is checked before the feature gate", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { inboundEmail: false } },
    });
    try {
      const res = await unauthenticated("/api/inbound-email/postmark", {
        method: "POST",
        headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
        body: postmarkPayload(),
      });
      assert.equal(res.status, 404);
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enabledFeatures: { inboundEmail: true } },
      });
    }
  });

  test("missing From/RawEmail in an otherwise-authenticated payload is a 400", async () => {
    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: { Subject: "no sender or body" },
    });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/inbound-email/postmark -- matching", () => {
  test("an org's own contactEmail matching exactly one partner files a Newsletter directly, no queue row", async () => {
    const partner = await createPartner({
      kind: "organization",
      contactEmail: `org@${FROM_DOMAIN}`,
    });

    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: postmarkPayload({ from: `org@${FROM_DOMAIN}` }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { matched: true });

    const newsletters = await prisma.partnerFile.findMany({ where: { partnerId: partner.id } });
    assert.equal(newsletters.length, 1);
    assert.equal(newsletters[0].contentType, "message/rfc822");
    assert.equal(newsletters[0].title, "Update from the field", "the email's Subject becomes the title");

    const queued = await prisma.inboundEmail.findMany({ where: { fromAddress: `org@${FROM_DOMAIN}` } });
    assert.equal(queued.length, 0);
  });

  test("a missionary's Adult.email matching exactly one partner files a Newsletter directly", async () => {
    const partner = await createPartner({ adults: [{ name: "Test Adult", email: `adult@${FROM_DOMAIN}` }] });

    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: postmarkPayload({ from: `adult@${FROM_DOMAIN}` }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { matched: true });

    const newsletters = await prisma.partnerFile.findMany({ where: { partnerId: partner.id } });
    assert.equal(newsletters.length, 1);
  });

  test("matching is case-insensitive", async () => {
    const partner = await createPartner({ contactEmail: `caseinsensitive@${FROM_DOMAIN}` });

    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: postmarkPayload({ from: `CaseInsensitive@${FROM_DOMAIN.toUpperCase()}` }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { matched: true });

    const newsletters = await prisma.partnerFile.findMany({ where: { partnerId: partner.id } });
    assert.equal(newsletters.length, 1);
  });

  test("zero matches queues the email for review instead of guessing", async () => {
    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: postmarkPayload({ from: `nobody-knows-this-address@${FROM_DOMAIN}` }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { matched: false });

    const queued = await prisma.inboundEmail.findMany({
      where: { fromAddress: `nobody-knows-this-address@${FROM_DOMAIN}` },
    });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].subject, "Update from the field");
  });

  test("two distinct partners sharing one address is ambiguous -- also queues rather than guessing", async () => {
    await createPartner({ contactEmail: `shared@${FROM_DOMAIN}` });
    await createPartner({ contactEmail: `shared@${FROM_DOMAIN}` });

    const res = await unauthenticated("/api/inbound-email/postmark", {
      method: "POST",
      headers: { Authorization: basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS) },
      body: postmarkPayload({ from: `shared@${FROM_DOMAIN}` }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { matched: false });

    const queued = await prisma.inboundEmail.findMany({ where: { fromAddress: `shared@${FROM_DOMAIN}` } });
    assert.equal(queued.length, 1);
  });
});

describe("the review queue -- GET/:id/raw/assign/discard", () => {
  test("unauthenticated is rejected on every queue route", async () => {
    assert.equal((await unauthenticated("/api/inbound-email")).status, 401);
    assert.equal((await unauthenticated("/api/inbound-email/some-id/raw")).status, 401);
    assert.equal(
      (await unauthenticated("/api/inbound-email/some-id/assign", { method: "POST", body: {} })).status,
      401
    );
    assert.equal((await unauthenticated("/api/inbound-email/some-id", { method: "DELETE" })).status, 401);
  });

  test("the queue routes 404 when the feature is off", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { inboundEmail: false } },
    });
    try {
      assert.equal((await admin("/api/inbound-email")).status, 404);
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enabledFeatures: { inboundEmail: true } },
      });
    }
  });

  test("a logged-in viewer can list the queue -- no role restriction beyond being authenticated, same as newsletters", async () => {
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `listable@${FROM_DOMAIN}`,
        subject: "Listable",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-listable.eml",
      },
    });
    try {
      const res = await viewer("/api/inbound-email");
      assert.equal(res.status, 200);
      assert.ok(res.body.some((row) => row.id === created.id));
      // bytes is never in the list response
      assert.ok(!res.body.some((row) => "bytes" in row));
    } finally {
      await prisma.inboundEmail.deleteMany({ where: { id: created.id } });
    }
  });

  test("GET /:id/raw streams back the stored bytes", async () => {
    const rawSource = "From: someone@example.org\r\nSubject: hi\r\n\r\nraw .eml body";
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `raw@${FROM_DOMAIN}`,
        subject: "hi",
        bytes: Buffer.from(rawSource),
        fileName: "inbound-raw.eml",
      },
    });
    try {
      const res = await admin(`/api/inbound-email/${created.id}/raw`);
      assert.equal(res.status, 200);
      assert.equal(res.body, rawSource);
    } finally {
      await prisma.inboundEmail.deleteMany({ where: { id: created.id } });
    }
  });

  test("GET /:id/raw on a missing id is a 404", async () => {
    assert.equal((await admin("/api/inbound-email/does-not-exist/raw")).status, 404);
  });

  test("POST /:id/assign -- viewer is rejected, editor can assign", async () => {
    const partner = await createPartner();
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `assignable@${FROM_DOMAIN}`,
        subject: "Assign me",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-assignable.eml",
      },
    });

    const viewerRes = await viewer(`/api/inbound-email/${created.id}/assign`, {
      method: "POST",
      body: { partnerId: partner.id },
    });
    assert.equal(viewerRes.status, 403);

    const res = await editor(`/api/inbound-email/${created.id}/assign`, {
      method: "POST",
      body: { partnerId: partner.id },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.partner.id, partner.id);

    const stillQueued = await prisma.inboundEmail.findUnique({ where: { id: created.id } });
    assert.equal(stillQueued, null, "the queue row should be gone once assigned");

    const newsletters = await prisma.partnerFile.findMany({ where: { partnerId: partner.id } });
    assert.equal(newsletters.length, 1);
    assert.equal(newsletters[0].title, "Assign me", "the queued email's subject becomes the title");
    assert.equal(newsletters[0].kind, "newsletter", "kind defaults to newsletter when omitted (#206)");
  });

  test("POST /:id/assign -- an explicit kind other than newsletter is honored (#206)", async () => {
    const partner = await createPartner();
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `survey@${FROM_DOMAIN}`,
        subject: "Survey response",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-survey.eml",
      },
    });

    const res = await editor(`/api/inbound-email/${created.id}/assign`, {
      method: "POST",
      body: { partnerId: partner.id, kind: "survey_response" },
    });
    assert.equal(res.status, 201);

    const files = await prisma.partnerFile.findMany({ where: { partnerId: partner.id } });
    assert.equal(files.length, 1);
    assert.equal(files[0].kind, "survey_response");
  });

  test('POST /:id/assign -- kind "other" requires a customKind, and stores it (#206)', async () => {
    const partner = await createPartner();
    const createdNoCustom = await prisma.inboundEmail.create({
      data: {
        fromAddress: `other1@${FROM_DOMAIN}`,
        subject: "Something else",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-other1.eml",
      },
    });
    const rejected = await editor(`/api/inbound-email/${createdNoCustom.id}/assign`, {
      method: "POST",
      body: { partnerId: partner.id, kind: "other" },
    });
    assert.equal(rejected.status, 400, 'kind "other" with no customKind is rejected');
    await prisma.inboundEmail.deleteMany({ where: { id: createdNoCustom.id } });

    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `other2@${FROM_DOMAIN}`,
        subject: "Something else, with a label",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-other2.eml",
      },
    });
    const res = await editor(`/api/inbound-email/${created.id}/assign`, {
      method: "POST",
      body: { partnerId: partner.id, kind: "other", customKind: "Board Minutes" },
    });
    assert.equal(res.status, 201);

    const files = await prisma.partnerFile.findMany({ where: { partnerId: partner.id, kind: "other" } });
    assert.equal(files.length, 1);
    assert.equal(files[0].customKind, "Board Minutes");
  });

  test("POST /:id/assign to a partner that no longer exists is a 400", async () => {
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `orphaned@${FROM_DOMAIN}`,
        subject: "Orphaned",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-orphaned.eml",
      },
    });
    try {
      const res = await admin(`/api/inbound-email/${created.id}/assign`, {
        method: "POST",
        body: { partnerId: "00000000-0000-0000-0000-000000000000" },
      });
      assert.equal(res.status, 400);
    } finally {
      await prisma.inboundEmail.deleteMany({ where: { id: created.id } });
    }
  });

  test("DELETE /:id -- editor is rejected (admin only), admin discards without filing anything", async () => {
    const created = await prisma.inboundEmail.create({
      data: {
        fromAddress: `discardable@${FROM_DOMAIN}`,
        subject: "Discard me",
        bytes: Buffer.from("raw source"),
        fileName: "inbound-discardable.eml",
      },
    });

    const editorRes = await editor(`/api/inbound-email/${created.id}`, { method: "DELETE" });
    assert.equal(editorRes.status, 403);

    const res = await admin(`/api/inbound-email/${created.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);

    const gone = await prisma.inboundEmail.findUnique({ where: { id: created.id } });
    assert.equal(gone, null);
  });
});

// The webhook password's own leak-check and "settings gated by the
// feature flag" coverage now lives in email.test.js, which owns the
// merged GET/PUT /api/settings/email route (including its inbound
// fields) -- no need to duplicate either here.
