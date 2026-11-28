// A prayer request filed as "Everyday" (category "situational": health, travel, family, paperwork) is staff
// only. It must never be posted to a chat, emailed to staff or to public subscribers, sent urgently, or sent
// after "approve now", by any path, and an edit to Everyday must pull back anything already queued.
// Nothing real is contacted: Postmark and GroupMe are faked with one global.fetch override, and no WhatsApp
// socket exists in the suite.
const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  FIXTURE_TAG,
  cleanupRow,
} = require("./helpers");
const { sendUrgentDispatch, clearDispatchRecords } = require("../../src/utils/dispatchOrchestrator");
const { sendDigestTier } = require("../../src/utils/emailDispatchDelivery");
const { runGroupMePass } = require("../../src/utils/groupmeChannel");
const { isEligibleForChannel, CHANNELS } = require("../../src/utils/dispatchEligibility");
const { buildBlurb } = require("../../src/utils/dispatchBlurbs");

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

const SECRET = "EVERYDAY-secret-diagnosis-text";
const OPEN = "MINISTRY-open-prayer-text";
const EMAIL_TAG = "everyday-never-shared";

let admin;
let originalSettings;
let originalCadences;
let partner;
let staffUser;
let subscriber;

const everything = () => JSON.stringify({ postmarkMessages, groupmeRequests });

async function setFeatures(enabledFeatures) {
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures } });
}

const create = (body) =>
  admin("/api/prayer-requests", {
    method: "POST",
    body: {
      partnerId: partner.id,
      category: "situational",
      requestText: SECRET,
      dateReceived: "2026-11-20",
      ...body,
    },
  });

// What a record carrying the category looks like, made directly: the second line of defence.
const everydayRow = (extra = {}) =>
  prisma.dispatchRecord.create({
    data: {
      partnerId: partner.id,
      type: "prayerRequestCreated",
      payload: { partnerName: partner.displayName, requestText: SECRET, category: "situational" },
      ...extra,
    },
  });

async function cleanup() {
  await prisma.dispatchRecord.deleteMany({});
  await prisma.prayerRequest.deleteMany({ where: { partner: { displayName: { contains: FIXTURE_TAG } } } });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalCadences = await prisma.user.findMany({ select: { id: true, cadence: true } });
  await prisma.user.updateMany({ data: { cadence: null } });
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      allowRestrictedPartnerDispatch: true,
      postmarkServerToken: true,
      emailFromAddress: true,
      groupmeAccessToken: true,
      groupmeGroupId: true,
      groupmePrayerTopicId: true,
      chatDispatchHour: true,
      chatDispatchPrayerRequests: true,
      lastGroupmeChatDispatchSentAt: true,
      emailDispatchDayOfWeek: true,
      emailDispatchDayOfMonth: true,
      emailDispatchHour: true,
    },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
      groupmeAccessToken: encryptField("gm-test-token"),
      groupmeGroupId: "12345",
      groupmePrayerTopicId: null,
      chatDispatchHour: new Date().getHours(),
      chatDispatchPrayerRequests: true,
      lastGroupmeChatDispatchSentAt: null,
      allowRestrictedPartnerDispatch: true,
    },
  });
  await cleanup();
  partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Everyday Partner`, isPublic: true },
  });
  staffUser = await prisma.user.create({
    data: {
      email: `${EMAIL_TAG}-staff@example.test`,
      role: "editor",
      active: true,
      digestScope: "all",
      cadence: "monthly",
    },
  });
  subscriber = await prisma.publicSubscriber.create({
    data: {
      email: `${EMAIL_TAG}-sub@example.test`,
      confirmedAt: new Date(),
      allPartners: true,
      cadence: "monthly",
    },
  });
});

beforeEach(async () => {
  postmarkMessages = [];
  groupmeRequests = [];
  await cleanup();
  await setFeatures({
    prayerRequests: true,
    groupme: true,
    outboundEmail: true,
    publicDirectory: true,
    publicPrayerDigest: true,
  });
});

after(async () => {
  global.fetch = realFetch;
  await cleanup();
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_TAG } } });
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: EMAIL_TAG } } });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await Promise.all(
    originalCadences.map((u) =>
      cleanupRow(prisma.user.update({ where: { id: u.id }, data: { cadence: u.cadence } }))
    )
  );
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  await removeTestUsers();
  await stopServer();
});

const monthlySettings = async () => ({
  ...(await prisma.churchSettings.findUnique({ where: { id: "singleton" } })),
  emailDispatchHour: 9,
  emailDispatchDayOfMonth: 1,
});

describe("an Everyday prayer request is never recorded for sending", () => {
  test("saving one makes no sharing record, even marked urgent and approved now", async () => {
    const res = await create({ isUrgent: true, approveNow: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await prisma.dispatchRecord.count(), 0);
    assert.ok(!everything().includes(SECRET), "nothing was posted or emailed on save");
  });

  test("a Ministry request is recorded (so the rest of this file is not vacuous)", async () => {
    const res = await create({ category: "strategic", requestText: OPEN });
    assert.equal(res.status, 201);
    const rows = await prisma.dispatchRecord.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.category, "strategic");
    assert.equal(rows[0].payload.prayerRequestId, res.body.id);
  });

  test("answering an Everyday request makes no record either", async () => {
    const res = await create({});
    const answered = await admin(`/api/prayer-requests/${res.body.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-11-25", answeredNote: "Better now" },
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.equal(await prisma.dispatchRecord.count(), 0);
  });
});

describe("even if a record for an Everyday request exists, no path sends it", () => {
  test("no channel is eligible for it, and it is never built into text", async () => {
    const row = await everydayRow({ dispatchReviewedAt: new Date(), dispatchReviewedText: SECRET });
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    for (const channel of Object.values(CHANNELS)) {
      assert.equal(isEligibleForChannel(row, channel, partner, settings, true), false, channel);
    }
    assert.equal(buildBlurb(row, partner, settings), null);
  });

  test("the scheduled chat post (GroupMe) skips it, while a Ministry request in the same pass posts", async () => {
    await everydayRow();
    await prisma.dispatchRecord.create({
      data: {
        partnerId: partner.id,
        type: "prayerRequestCreated",
        payload: { partnerName: "P", requestText: OPEN },
      },
    });
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await runGroupMePass(settings, new Date());
    assert.ok(groupmeRequests.length > 0, "the Ministry request posted");
    assert.ok(everything().includes(OPEN));
    assert.ok(!everything().includes(SECRET), "the Everyday request was not posted");
  });

  test("the staff digest and the public digest skip it", async () => {
    await everydayRow();
    await sendDigestTier("monthly", await monthlySettings());
    assert.ok(!everything().includes(SECRET));
    assert.equal(postmarkMessages.length, 0, "nobody was emailed anything");
  });

  test("urgent send skips it on every channel", async () => {
    const row = await everydayRow();
    const result = await sendUrgentDispatch(row, partner);
    assert.deepEqual([result.groupmePosted, result.whatsappPosted, result.emailSent], [false, false, false]);
    assert.ok(!everything().includes(SECRET));
  });

  test("'review and approve now' (editing the queued text) does not release it", async () => {
    const row = await everydayRow();
    const edited = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: SECRET },
    });
    assert.ok([200, 404].includes(edited.status));
    const reviewed = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    if (reviewed) {
      for (const channel of Object.values(CHANNELS)) {
        assert.equal(isEligibleForChannel(reviewed, channel, partner, settings, true), false);
      }
    }
    await runGroupMePass(settings, new Date());
    await sendDigestTier("monthly", await monthlySettings());
    await sendUrgentDispatch(reviewed || row, partner);
    assert.ok(!everything().includes(SECRET));
  });

  test("it never shows in the review queue, and housekeeping clears it at once", async () => {
    await everydayRow();
    const queue = await admin("/api/dispatches/pending");
    assert.equal(queue.status, 200);
    assert.ok(!JSON.stringify(queue.body).includes(SECRET));
    const cleared = await clearDispatchRecords();
    assert.equal(cleared.cleared, 1);
    assert.equal(await prisma.dispatchRecord.count(), 0);
  });
});

describe("a request edited from Ministry to Everyday while queued", () => {
  test("the queued record is pulled back and never goes out", async () => {
    const made = await create({ category: "strategic", requestText: SECRET });
    assert.equal(made.status, 201);
    assert.equal(await prisma.dispatchRecord.count(), 1, "queued while it was Ministry");

    const edited = await admin(`/api/prayer-requests/${made.body.id}`, {
      method: "PUT",
      body: { category: "situational" },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(await prisma.dispatchRecord.count(), 0, "the queued record was removed");

    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await runGroupMePass(settings, new Date());
    await sendDigestTier("monthly", await monthlySettings());
    assert.ok(!everything().includes(SECRET));
  });

  test("it also pulls back a queued 'answered' record, and leaves other requests' records alone", async () => {
    const mine = await create({ category: "strategic", requestText: SECRET });
    const other = await create({ category: "strategic", requestText: OPEN });
    await admin(`/api/prayer-requests/${mine.body.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-11-25", answeredNote: "done" },
    });
    assert.equal(await prisma.dispatchRecord.count(), 3);
    await admin(`/api/prayer-requests/${mine.body.id}`, { method: "PUT", body: { category: "situational" } });
    const left = await prisma.dispatchRecord.findMany();
    assert.equal(left.length, 1);
    assert.equal(left[0].payload.prayerRequestId, other.body.id);
  });

  test("an unrelated edit to an Everyday request does not touch the queue", async () => {
    const other = await create({ category: "strategic", requestText: OPEN });
    const mine = await create({});
    const edited = await admin(`/api/prayer-requests/${mine.body.id}`, {
      method: "PUT",
      body: { notes: "a note" },
    });
    assert.equal(edited.status, 200);
    const left = await prisma.dispatchRecord.findMany();
    assert.deepEqual(
      left.map((r) => r.payload.prayerRequestId),
      [other.body.id]
    );
  });
});
