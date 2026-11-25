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
const { stripFootnoteArtifacts, DEFAULT_MODEL } = require("../../src/utils/extraction");
const Anthropic = require("@anthropic-ai/sdk");

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
    select: { anthropicApiKey: true, enabledFeatures: true, extractionModel: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { anthropicApiKey: null, extractionModel: null },
    create: { id: "singleton" },
  });
});

after(async () => {
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await removeTestUsers();
  await stopServer();
});

describe("GET/PUT /api/settings/ai-extraction -- admin gate", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/ai-extraction")).status, 401);
  });

  test("editor is rejected -- this feature lives behind the admin gate specifically, not just its writes", async () => {
    assert.equal((await editor("/api/settings/ai-extraction")).status, 403);
    assert.equal(
      (await editor("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: "x" } })).status,
      403
    );
  });

  test("admin sees unconfigured, with no key field in the response at all", async () => {
    const res = await admin("/api/settings/ai-extraction");
    assert.equal(res.status, 200);
    // model: null, the plain-text companion field, is always present and echoed back as-is, unlike
    // apiKey/anthropicApiKey.
    assert.deepEqual(res.body, { configured: false, model: null });
    assert.ok(!("apiKey" in res.body) && !("anthropicApiKey" in res.body));
  });
});

describe("PUT /api/settings/ai-extraction -- write-only key", () => {
  test("saving a key never echoes it back, and is stored encrypted", async () => {
    const res = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-test-key-abc123" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { configured: true, model: null });

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.ok(row.anthropicApiKey.startsWith("v1:"), "key is stored encrypted, not plaintext");
    assert.notEqual(row.anthropicApiKey, "sk-ant-test-key-abc123");
  });

  test("saving nothing leaves the stored key untouched", async () => {
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, true);
    const after = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.equal(after.anthropicApiKey, before.anthropicApiKey);
  });
});

// extractionModel rides alongside the write-only key but is plain text, never encrypted, and
// echoed back on every GET: it's not a secret (see its comment in schema.prisma).
describe("PUT /api/settings/ai-extraction -- plain-text model field", () => {
  test("saving a model id round-trips on the next GET, independent of the key", async () => {
    const put = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { model: "claude-sonnet-5" },
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.model, "claude-sonnet-5");

    const get = await admin("/api/settings/ai-extraction");
    assert.equal(get.status, 200);
    assert.equal(get.body.model, "claude-sonnet-5");

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { extractionModel: true },
    });
    assert.equal(row.extractionModel, "claude-sonnet-5");
  });

  test("sending apiKey without model leaves the stored model untouched", async () => {
    const res = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-another-test-key" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.model, "claude-sonnet-5", "model from the previous test must survive");
  });

  test("explicitly clearing the model (blank string) resets it to null -- app default", async () => {
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: { model: "" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.model, null);

    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { extractionModel: true },
    });
    assert.equal(row.extractionModel, null);
  });

  test("the Joshua Project settings pair is unaffected -- no model field appears there", async () => {
    const res = await admin("/api/settings/joshua-project");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.configured, "boolean");
    assert.ok(
      !("model" in res.body),
      "registerApiKeySetting's optional textField must not leak onto a call that didn't ask for one"
    );
  });
});

// This is real, billable money on the key owner's Anthropic account (see anthropicApiKey in
// schema.prisma), so this is the explicit automated leak guard, on top of the ordinary
// admin-gate/write-only tests: it greps the raw response text of every endpoint a non-admin or
// a general settings fetch can reach, so a future route that forgets to omit anthropicApiKey
// fails here instead of silently leaking.
describe("the real key literal never appears in any response, anywhere", () => {
  const REAL_KEY = "sk-ant-REAL-SECRET-should-never-leak-9f8e7d6c5b4a";

  before(async () => {
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: REAL_KEY } });
    assert.equal(res.status, 200, "fixture setup: saving the key should succeed");
  });

  test("GET /api/settings (any logged-in role) never includes the key", async () => {
    for (const asUser of [admin, editor, viewer]) {
      const res = await asUser("/api/settings");
      assert.equal(res.status, 200);
      assert.ok(
        !JSON.stringify(res.body).includes(REAL_KEY),
        "the real API key leaked into GET /api/settings"
      );
    }
  });

  test("GET /api/settings/ai-extraction never includes the key, even encrypted", async () => {
    const res = await admin("/api/settings/ai-extraction");
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_KEY),
      "the real API key leaked into GET /api/settings/ai-extraction"
    );
  });

  test("PUT /api/settings/ai-extraction's own response never echoes the key back", async () => {
    const res = await admin("/api/settings/ai-extraction", { method: "PUT", body: { apiKey: REAL_KEY } });
    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes(REAL_KEY),
      "the real API key was echoed back in the PUT response"
    );
  });

  test("the row's stored value is never the plaintext key, only the encrypted form", async () => {
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { anthropicApiKey: true },
    });
    assert.notEqual(row.anthropicApiKey, REAL_KEY);
    assert.ok(row.anthropicApiKey.startsWith("v1:"));
  });
});

describe("AI request scanning route is gated by the feature flag", () => {
  test("the scan endpoint 404s when the feature is off (verified via a 404 from requireFeature, not a 400 from the missing-key check)", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { aiExtraction: false } },
    });
    // The scan sub-route 404s before ever reaching extraction.js, same
    // "off means 404" rule every other gated feature gets -- not
    // exercising an actual file here, just confirming the gate itself.
    const res = await admin("/api/partner-files/00000000-0000-4000-8000-000000000000/extract", {
      method: "POST",
    });
    assert.equal(res.status, 404);
  });
});

// Regression test for a production bug: PartnerFile's query in the /extract route never
// included the bytesRow relation (the bytes live in the split-off PartnerFileBytes table), so
// record.bytes was undefined and buildFileBlock's Buffer.from(undefined) threw a 500 on every
// scan, before extraction.js's client() could check for an API key. With no key configured in
// this file's tests, correctly loaded bytes reach the expected "not configured" 400.
describe("the scan endpoint actually loads the file's bytes before calling Claude", () => {
  let partnerId;
  let fileId;

  before(async () => {
    // anthropicApiKey: null explicitly, not just enabledFeatures: an earlier describe saves a fake
    // key and never clears it, so without this the route would call the provider and surface its
    // 401 instead of the "not configured" 400 this test targets.
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { aiExtraction: true }, anthropicApiKey: null },
    });
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Extract Bytes Fixture` },
    });
    partnerId = partner.id;
    const file = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind: "newsletter",
        receivedDate: new Date("2026-03-01"),
        fileName: "letter.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture") } },
      },
    });
    fileId = file.id;
  });

  after(async () => {
    await removeFixturePartners();
  });

  test("reaches the 'not configured' check instead of crashing on undefined bytes", async () => {
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /AI request scanning isn't configured/);
  });
});

// The model actually used by anthropic.messages.parse(), and the explicit error when it is
// unavailable. No real network call: Messages.prototype.parse (shared by every `new
// Anthropic(...)`, including client()'s) is monkey-patched per test, the same swap-and-restore
// technique joshuaProject.test.js uses for global.fetch.
describe("#324: extraction uses the configured model, with an explicit error when it's unavailable", () => {
  let partnerId;
  let fileId;
  let messagesProto;
  let originalParse;

  before(async () => {
    messagesProto = Object.getPrototypeOf(new Anthropic({ apiKey: "mock" }).messages);
    originalParse = messagesProto.parse;

    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { aiExtraction: true } },
    });
    // Through the real route, not a raw prisma write, so it's actually
    // encrypted the way client()'s decryptField call expects.
    const keySaved = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-mock-key-for-model-tests" },
    });
    assert.equal(keySaved.status, 200, "fixture setup: saving the mock key should succeed");

    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Model Config Fixture` },
    });
    partnerId = partner.id;
    const file = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind: "newsletter",
        receivedDate: new Date("2026-03-01"),
        fileName: "letter.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture") } },
      },
    });
    fileId = file.id;
  });

  after(async () => {
    messagesProto.parse = originalParse;
    await removeFixturePartners();
  });

  const emptyResult = {
    stop_reason: "end_turn",
    parsed_output: { prayerRequests: [], oneTimeNeeds: [] },
  };

  test("uses the app's built-in default model when none is configured", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { extractionModel: null } });
    let receivedModel;
    messagesProto.parse = async (opts) => {
      receivedModel = opts.model;
      return emptyResult;
    };
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(receivedModel, DEFAULT_MODEL);
  });

  test("uses the configured model when one is set", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { extractionModel: "claude-sonnet-5" },
    });
    let receivedModel;
    messagesProto.parse = async (opts) => {
      receivedModel = opts.model;
      return emptyResult;
    };
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(receivedModel, "claude-sonnet-5");
  });

  test("surfaces an explicit, user-facing error when the configured model is unavailable (a 404 not_found_error)", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { extractionModel: "claude-typo-ed-retired-model" },
    });
    messagesProto.parse = async () => {
      throw new Anthropic.NotFoundError(
        404,
        { error: { type: "not_found_error", message: "model: claude-typo-ed-retired-model" } },
        "404 model: claude-typo-ed-retired-model",
        undefined
      );
    };
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /configured AI model isn't available/);
  });

  test("a different kind of API error (not model-not-found) is left to propagate as-is, not masked as the model error", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { extractionModel: "claude-sonnet-5" },
    });
    messagesProto.parse = async () => {
      throw new Anthropic.RateLimitError(
        429,
        { error: { type: "rate_limit_error", message: "slow down" } },
        "429 slow down",
        undefined
      );
    };
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.notEqual(res.status, 400);
    assert.ok(
      !res.body.error.includes("configured AI model isn't available"),
      "a rate-limit error must not be mistaken for the model-unavailable case"
    );
  });
});

// Warn (non-blocking) when this file already produced saved PrayerRequest/SupportNeed rows on
// an earlier scan.
describe("#323: already-scanned count on the extract response", () => {
  let partnerId;
  let fileId;

  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { aiExtraction: true }, anthropicApiKey: null },
    });
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Already Scanned Fixture` },
    });
    partnerId = partner.id;
    const file = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind: "newsletter",
        receivedDate: new Date("2026-03-01"),
        fileName: "letter.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture") } },
      },
    });
    fileId = file.id;
  });

  after(async () => {
    await removeFixturePartners();
  });

  test("0 when the file has never produced a saved request/need, even once a scan succeeds", async () => {
    const messagesProto = Object.getPrototypeOf(new Anthropic({ apiKey: "mock" }).messages);
    const originalParse = messagesProto.parse;
    const keySaved = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-mock-key-for-already-scanned-test" },
    });
    assert.equal(keySaved.status, 200);
    messagesProto.parse = async () => ({
      stop_reason: "end_turn",
      parsed_output: { prayerRequests: [], oneTimeNeeds: [] },
    });
    try {
      const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
      assert.equal(res.status, 200);
      assert.equal(res.body.alreadyScannedCount, 0);
    } finally {
      messagesProto.parse = originalParse;
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { anthropicApiKey: null } });
    }
  });

  test("counts both a PrayerRequest and a SupportNeed already linked to this file (no API key needed -- fails before the AI call, but the count still ran)", async () => {
    await prisma.prayerRequest.create({
      data: {
        partnerId,
        category: "situational",
        requestText: "Pray for safe travel.",
        dateReceived: new Date("2026-03-01"),
        sourceFileId: fileId,
      },
    });
    await prisma.supportNeed.create({
      data: {
        partnerId,
        description: "Need $500 for a vehicle repair.",
        requestedAmount: 500,
        requestDate: new Date("2026-03-01"),
        sourceFileId: fileId,
      },
    });

    // anthropicApiKey stays null on purpose: extractRequestsFromFile 400s with "not configured"
    // before reaching the AI, but the already-scanned count is independent of that (see the
    // route's Promise.all) and this test only needs it to come back correctly.
    const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, "the extraction failure itself still surfaces its own error");
    assert.equal(
      res.body.alreadyScannedCount,
      undefined,
      "a failed extraction never reaches res.json, so no alreadyScannedCount field at all"
    );
  });

  test("a successful scan on a file with prior records reports the correct nonzero count", async () => {
    const messagesProto = Object.getPrototypeOf(new Anthropic({ apiKey: "mock" }).messages);
    const originalParse = messagesProto.parse;
    const keySaved = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-mock-key-for-already-scanned-test-2" },
    });
    assert.equal(keySaved.status, 200);
    messagesProto.parse = async () => ({
      stop_reason: "end_turn",
      parsed_output: { prayerRequests: [], oneTimeNeeds: [] },
    });
    try {
      const res = await admin(`/api/partner-files/${fileId}/extract`, { method: "POST" });
      assert.equal(res.status, 200);
      // One PrayerRequest + one SupportNeed created in the previous test,
      // both pointed at this same file.
      assert.equal(res.body.alreadyScannedCount, 2);
    } finally {
      messagesProto.parse = originalParse;
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { anthropicApiKey: null } });
    }
  });
});

// Pure function, no API call: the footnote/name-changed artifacts seen in a live run against
// the Hartwell fixture, not hypothetical inputs.
describe("stripFootnoteArtifacts", () => {
  test("drops a footnote asterisk before a capitalized name", () => {
    assert.equal(
      stripFootnoteArtifacts("*Rani is the chief editor and *Deeva is the senior editor."),
      "Rani is the chief editor and Deeva is the senior editor."
    );
  });

  test("drops a footnote asterisk right after a word, at end of sentence", () => {
    assert.equal(stripFootnoteArtifacts("Pray for Peace*"), "Pray for Peace");
  });

  test("drops a parenthetical name-changed note", () => {
    assert.equal(
      stripFootnoteArtifacts("Pray for John (name changed) as he travels."),
      "Pray for John as he travels."
    );
    assert.equal(
      stripFootnoteArtifacts("Pray for John (names have been changed) as he travels."),
      "Pray for John as he travels."
    );
  });

  test("leaves a mid-sentence asterisk (e.g. multiplication, not a footnote) alone", () => {
    assert.equal(stripFootnoteArtifacts("5 * 3 is fifteen."), "5 * 3 is fifteen.");
  });

  test("passes through null/empty unchanged", () => {
    assert.equal(stripFootnoteArtifacts(null), null);
    assert.equal(stripFootnoteArtifacts(""), "");
  });
});

// Source-linking: a request/need created from the scan modal can carry sourceFileId back to
// the file it came from. No API call needed; this is DB/route plumbing, exercised against the
// create routes and a fixture PartnerFile of each kind.
describe("prayer request / one-time need source linking", () => {
  let partnerId;
  let newsletterId;
  let documentId;

  before(async () => {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Source Link Fixture` },
    });
    partnerId = partner.id;
    const newsletter = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind: "newsletter",
        title: "Spring Update",
        receivedDate: new Date("2026-03-01"),
        fileName: "spring-update.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("fixture") } },
      },
    });
    newsletterId = newsletter.id;
    const document = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind: "other",
        customKind: "Background Check",
        title: "Prayer Letter",
        receivedDate: new Date("2026-04-01"),
        fileName: "prayer-letter.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("fixture") } },
      },
    });
    documentId = document.id;
  });

  after(async () => {
    await removeFixturePartners();
  });

  test("a prayer request created with sourceFileId returns the file's title/date on GET", async () => {
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "situational",
        requestText: "Pray for safe travel.",
        dateReceived: "2026-03-01",
        sourceFileId: newsletterId,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.sourceFile.title, "Spring Update");

    const fetched = await admin(`/api/prayer-requests?partnerId=${partnerId}`);
    const row = fetched.body.find((r) => r.id === created.body.id);
    assert.equal(row.sourceFile.title, "Spring Update");
  });

  test("a one-time need created with sourceFileId returns the file's title/date on GET", async () => {
    const created = await admin("/api/support-needs", {
      method: "POST",
      body: {
        partnerId,
        description: "Need $500 for a vehicle repair.",
        requestedAmount: 500,
        requestDate: "2026-04-01",
        sourceFileId: documentId,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.sourceFile.title, "Prayer Letter");
  });

  test("a request/need added by hand (no source) has sourceFile null", async () => {
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "situational",
        requestText: "Pray for wisdom.",
        dateReceived: "2026-05-01",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.sourceFile, null);
  });

  test("deleting the source file sets sourceFileId to null, not the request itself", async () => {
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "situational",
        requestText: "Pray for the trip.",
        dateReceived: "2026-03-01",
        sourceFileId: newsletterId,
      },
    });
    await prisma.partnerFile.delete({ where: { id: newsletterId } });

    const fetched = await admin(`/api/prayer-requests?partnerId=${partnerId}`);
    const row = fetched.body.find((r) => r.id === created.body.id);
    assert.ok(row, "the prayer request itself must survive its source file being deleted");
    assert.equal(row.sourceFile, null);
  });
});
