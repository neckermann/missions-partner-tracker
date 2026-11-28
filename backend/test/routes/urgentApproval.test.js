// An urgent update about a restricted partner is held for staff review, so it cannot go out when it is made.
// Approving it is what lets it go, and it goes at once (not at the next schedule). A held update that was not
// urgent still waits for its schedule, and editing the wording after the first approval never sends again.
// Nothing real is contacted: Postmark and GroupMe are faked with one global.fetch override.
const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer, ensureTestUsers, removeTestUsers, FIXTURE_TAG } = require("./helpers");

const realFetch = global.fetch;
let postmarkMessages = [];
let groupmeRequests = [];
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    const sent = options?.body ? JSON.parse(options.body) : [];
    const messages = Array.isArray(sent) ? sent : [sent];
    postmarkMessages.push(...messages);
    const body = messages.map((m) => ({ ErrorCode: 0, Message: "OK", MessageID: "fake-id", To: m.To }));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  if (s.startsWith("https://api.groupme.com")) {
    groupmeRequests.push({ url: s, body: options?.body ? JSON.parse(options.body) : null });
    return Promise.resolve({ ok: true, status: 202, statusText: "", json: async () => ({ response: null }) });
  }
  return realFetch(url, options);
};

const EMAIL_TAG = "urgent-approval";

let admin;
let originalSettings;
let originalCadences;
let partner;
let staffUser;
let subscriber;

const everything = () => JSON.stringify({ postmarkMessages, groupmeRequests });
const TEXT = "URGENT-held-then-approved";

async function cleanup() {
  await prisma.dispatchRecord.deleteMany({});
  await prisma.prayerRequest.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
}

const create = (body) =>
  admin("/api/prayer-requests", {
    method: "POST",
    body: {
      partnerId: partner.id,
      category: "strategic",
      requestText: TEXT,
      dateReceived: "2026-11-20",
      ...body,
    },
  });

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      allowRestrictedPartnerDispatch: true,
      groupmeAccessToken: true,
      groupmeGroupId: true,
      groupmePrayerTopicId: true,
      chatDispatchPrayerRequests: true,
    },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      groupmeAccessToken: encryptField("gm-test-token"),
      groupmeGroupId: "12345",
      groupmePrayerTopicId: null,
      chatDispatchPrayerRequests: true,
      allowRestrictedPartnerDispatch: true,
    },
  });
  await cleanup();
  partner = await prisma.partner.create({
    data: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Held Partner`,
      isPublic: true,
      isRestricted: true,
    },
  });
});

beforeEach(async () => {
  groupmeRequests = [];
  postmarkMessages = [];
  await cleanup();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { prayerRequests: true, groupme: true } },
  });
});

after(async () => {
  global.fetch = realFetch;
  await cleanup();
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  await removeTestUsers();
  await stopServer();
});

const heldRow = () => prisma.dispatchRecord.findFirst({ where: { partnerId: partner.id } });
const approve = (id) =>
  admin(`/api/dispatches/pending/${id}`, { method: "PUT", body: { text: "A prayer need for our partner." } });

describe("approving a held urgent update sends it at once", () => {
  test("an urgent update about a restricted partner is held, then goes out on the first approval only", async () => {
    const res = await create({ isUrgent: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await heldRow();
    assert.ok(row, "the held update is recorded");
    assert.equal(row.payload.urgent, true);
    assert.equal(groupmeRequests.length, 0, "nothing goes out while it is held");

    const approved = await approve(row.id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.urgentSent?.groupmePosted, true);
    assert.equal(groupmeRequests.length, 1, "approving sends it now");

    const edited = await approve(row.id);
    assert.equal(edited.status, 200);
    assert.equal(groupmeRequests.length, 1, "editing the wording afterwards does not send it again");
    assert.equal(edited.body.urgentSent, null);
  });

  test("an update that was not urgent still waits for its schedule after approval", async () => {
    const res = await create({ isUrgent: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await heldRow();
    assert.ok(row);
    assert.equal(row.payload.urgent, undefined);
    const approved = await approve(row.id);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.urgentSent, null);
    assert.equal(groupmeRequests.length, 0, everything());
  });
});
