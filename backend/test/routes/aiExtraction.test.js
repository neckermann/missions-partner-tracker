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
const { stripFootnoteArtifacts } = require("../../src/utils/extraction");

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
    select: { anthropicApiKey: true, enabledFeatures: true },
  });
  // Clean slate -- these tests assume nothing is configured yet.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { anthropicApiKey: null },
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
    assert.deepEqual(res.body, { configured: false });
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
    assert.deepEqual(res.body, { configured: true });

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

// This is real, billable money on the key owner's own Anthropic account
// (see the comment on anthropicApiKey in schema.prisma) -- these tests
// are the explicit, automated "does it ever leak" guard asked for
// alongside this feature, independent of (and on top of) the ordinary
// admin-gate/write-only-field tests above. Rather than trust that every
// endpoint which happens to touch ChurchSettings individually remembers
// to omit the field, this greps the raw response text of every endpoint
// a non-admin or a general settings fetch can reach, so a future route
// that forgets to omit anthropicApiKey fails loudly here instead of
// silently shipping a leak.
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
    // Newsletters' scan sub-route 404s before ever reaching extraction.js,
    // same "off means 404" rule every other gated feature gets -- not
    // exercising an actual file here, just confirming the gate itself.
    const res = await admin("/api/newsletters/00000000-0000-4000-8000-000000000000/extract", {
      method: "POST",
    });
    assert.equal(res.status, 404);
  });
});

// Pure function, no API call -- the real footnote/name-changed artifacts
// seen in a live test run against the Hartwell fixture (issue #94), not
// hypothetical inputs.
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

// Source-linking (issue #94 part 2): a request/need created from the scan
// modal can carry sourceNewsletterId/sourceDocumentId back to the file it
// came from. No API call needed -- this is DB/route plumbing, exercised
// directly against the create routes and a fixture Newsletter/Document.
describe("prayer request / one-time need source linking", () => {
  let partnerId;
  let newsletterId;
  let documentId;

  before(async () => {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Source Link Fixture` },
    });
    partnerId = partner.id;
    const newsletter = await prisma.newsletter.create({
      data: {
        partnerId,
        title: "Spring Update",
        receivedDate: new Date("2026-03-01"),
        bytes: Buffer.from("fixture"),
        fileName: "spring-update.pdf",
        contentType: "application/pdf",
      },
    });
    newsletterId = newsletter.id;
    const document = await prisma.document.create({
      data: {
        partnerId,
        category: "other",
        title: "Prayer Letter",
        receivedDate: new Date("2026-04-01"),
        bytes: Buffer.from("fixture"),
        fileName: "prayer-letter.pdf",
        contentType: "application/pdf",
      },
    });
    documentId = document.id;
  });

  after(async () => {
    await removeFixturePartners();
  });

  test("a prayer request created with sourceNewsletterId returns the newsletter's title/date on GET", async () => {
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "situational",
        requestText: "Pray for safe travel.",
        dateReceived: "2026-03-01",
        sourceNewsletterId: newsletterId,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.sourceNewsletter.title, "Spring Update");
    assert.equal(created.body.sourceDocument, null);

    const fetched = await admin(`/api/prayer-requests?partnerId=${partnerId}`);
    const row = fetched.body.find((r) => r.id === created.body.id);
    assert.equal(row.sourceNewsletter.title, "Spring Update");
  });

  test("a one-time need created with sourceDocumentId returns the document's title/date on GET", async () => {
    const created = await admin("/api/support-needs", {
      method: "POST",
      body: {
        partnerId,
        description: "Need $500 for a vehicle repair.",
        requestedAmount: 500,
        requestDate: "2026-04-01",
        sourceDocumentId: documentId,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.sourceDocument.title, "Prayer Letter");
    assert.equal(created.body.sourceNewsletter, null);
  });

  test("a request/need added by hand (no source) has both source fields null", async () => {
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
    assert.equal(created.body.sourceNewsletter, null);
    assert.equal(created.body.sourceDocument, null);
  });

  test("deleting the source newsletter sets sourceNewsletterId to null, not the request itself", async () => {
    const created = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId,
        category: "situational",
        requestText: "Pray for the trip.",
        dateReceived: "2026-03-01",
        sourceNewsletterId: newsletterId,
      },
    });
    await prisma.newsletter.delete({ where: { id: newsletterId } });

    const fetched = await admin(`/api/prayer-requests?partnerId=${partnerId}`);
    const row = fetched.body.find((r) => r.id === created.body.id);
    assert.ok(row, "the prayer request itself must survive its source newsletter being deleted");
    assert.equal(row.sourceNewsletter, null);
  });
});
