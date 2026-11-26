const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { clearDispatchRecords, sendUrgentDispatch } = require("../../src/utils/dispatchOrchestrator");

// clearDispatchRecords and sendUrgentDispatch have no direct coverage elsewhere:
// dispatches.test.js exercises sendUrgentDispatch only indirectly (GET
// /api/dispatches/urgent-recipient-count never sends) and emailDispatchDelivery.test.js covers
// sendDigestTier. Same mock-the-whole-domain technique as emailDispatchDelivery.test.js for
// Postmark, extended to GroupMe's API: both are plain HTTP, so one global.fetch override
// handles both. WhatsApp's send goes over a socket (whatsappClient.js), not HTTP, and is
// deliberately not exercised here; see the "WhatsApp" describe below.
const realFetch = global.fetch;
let postmarkMessages = [];
let groupmeRequests = [];
function resetMocks() {
  postmarkMessages = [];
  groupmeRequests = [];
}
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    const sent = options?.body ? JSON.parse(options.body) : [];
    const messages = Array.isArray(sent) ? sent : [sent];
    postmarkMessages.push(...messages);
    const responseBody = messages.map((m) => ({
      ErrorCode: 0,
      Message: "OK",
      MessageID: "fake-id",
      SubmittedAt: "2026-01-01T00:00:00Z",
      To: m.To,
    }));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    });
  }
  if (s.startsWith("https://api.groupme.com")) {
    groupmeRequests.push({ url: s, body: options?.body ? JSON.parse(options.body) : null });
    return Promise.resolve({
      ok: true,
      status: 202,
      statusText: "",
      json: async () => ({ response: null }),
    });
  }
  return realFetch(url, options);
};

const FIXTURE_TAG = "ZZTEST-dispatchOrchestrator";

async function cleanup() {
  // Unconditional for DispatchRecord, same reasoning as
  // emailDispatchDelivery.test.js's own cleanup() -- any leftover row
  // (seed data, another file) would otherwise leak into this file's
  // exact-count/exact-array assertions.
  await prisma.dispatchRecord.deleteMany({});
  await prisma.userFollowedPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.publicSubscriberPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: "dispatch-orchestrator-test" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "dispatch-orchestrator-test" } } });
}

function createPartner(overrides) {
  return prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Partner`, isPublic: false, ...overrides },
  });
}

function createRow(partnerId, type, payload, overrides) {
  return prisma.dispatchRecord.create({ data: { partnerId, type, payload, ...overrides } });
}

function createAdminUser(overrides) {
  return prisma.user.create({
    data: {
      email: `dispatch-orchestrator-test-${Math.random().toString(36).slice(2)}@example.test`,
      role: "editor",
      active: true,
      digestScope: "all",
      ...overrides,
    },
  });
}

function createPublicSubscriber(overrides) {
  return prisma.publicSubscriber.create({
    data: {
      email: `dispatch-orchestrator-test-${Math.random().toString(36).slice(2)}@example.test`,
      confirmedAt: new Date(),
      allPartners: true,
      ...overrides,
    },
  });
}

let originalSettings;
let originalUserCadences;

before(async () => {
  originalUserCadences = await prisma.user.findMany({ select: { id: true, cadence: true } });
  await prisma.user.updateMany({ data: { cadence: null } });
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      allowRestrictedPartnerDispatch: true,
      chatDispatchPrayerRequests: true,
      chatDispatchOneTimeNeeds: true,
      chatDispatchNewsletters: true,
      postmarkServerToken: true,
      emailFromAddress: true,
      churchName: true,
      groupmeAccessToken: true,
      groupmeGroupId: true,
      groupmePrayerTopicId: true,
      groupmeOneTimeNeedTopicId: true,
      whatsappAnnouncementGroupId: true,
      emailDispatchDayOfWeek: true,
      emailDispatchDayOfMonth: true,
      emailDispatchHour: true,
    },
  });
  await cleanup();
});

beforeEach(async () => {
  resetMocks();
  await cleanup();
});

after(async () => {
  global.fetch = realFetch;
  await cleanup();
  await Promise.all(
    originalUserCadences.map((u) =>
      prisma.user.update({ where: { id: u.id }, data: { cadence: u.cadence } }).catch(() => {})
    )
  );
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
});

describe("clearDispatchRecords", () => {
  test("a row nothing currently applies to never clears -- the vacuous-case guard", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: {},
        emailDispatchDayOfWeek: null,
        emailDispatchDayOfMonth: null,
        emailDispatchHour: null,
      },
    });
    const partner = await createPartner();
    const row = await createRow(partner.id, "newsletterCreated", { partnerName: partner.displayName });

    const { cleared } = await clearDispatchRecords();
    assert.equal(cleared, 0);
    assert.ok(await prisma.dispatchRecord.findUnique({ where: { id: row.id } }), "row must still be queued");
  });

  test("an unsent row nothing applies to is dropped after 14 days, not before", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: {},
        emailDispatchDayOfWeek: null,
        emailDispatchDayOfMonth: null,
        emailDispatchHour: null,
      },
    });
    const partner = await createPartner();
    const day = 24 * 60 * 60 * 1000;
    const fresh = await createRow(
      partner.id,
      "newsletterCreated",
      { partnerName: "x" },
      { createdAt: new Date(Date.now() - 13 * day) }
    );
    const stale = await createRow(
      partner.id,
      "newsletterCreated",
      { partnerName: "x" },
      { createdAt: new Date(Date.now() - 15 * day) }
    );

    const { cleared } = await clearDispatchRecords();
    assert.equal(cleared, 1);
    assert.ok(await prisma.dispatchRecord.findUnique({ where: { id: fresh.id } }));
    assert.equal(await prisma.dispatchRecord.findUnique({ where: { id: stale.id } }), null);
  });

  test("an old row held for review is kept even when nothing applies", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: {}, allowRestrictedPartnerDispatch: true },
    });
    const partner = await createPartner({ isRestricted: true });
    const row = await createRow(
      partner.id,
      "prayerRequestCreated",
      { partnerName: "x", requestText: "t" },
      { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    );
    await clearDispatchRecords();
    assert.ok(await prisma.dispatchRecord.findUnique({ where: { id: row.id } }));
  });

  test("restricted-and-unreviewed never clears, even once GroupMe has posted it", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: true },
        allowRestrictedPartnerDispatch: true,
        chatDispatchPrayerRequests: true,
      },
    });
    const partner = await createPartner({ isRestricted: true });
    // groupmeDispatchedAt already set, as if it had somehow posted --
    // needsReview must still hold the row regardless of any channel's
    // own stamp.
    const row = await createRow(
      partner.id,
      "prayerRequestCreated",
      { partnerName: partner.displayName, requestText: "test" },
      { groupmeDispatchedAt: new Date() }
    );

    const { cleared } = await clearDispatchRecords();
    assert.equal(cleared, 0);
    assert.ok(await prisma.dispatchRecord.findUnique({ where: { id: row.id } }));
  });

  test("a muted GroupMe content type is treated as permanently resolved for that channel, letting the row clear once every other applicable channel has sent", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: true, outboundEmail: true },
        chatDispatchNewsletters: false,
        emailDispatchDayOfWeek: 3,
        emailDispatchHour: 9,
      },
    });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const partner = await createPartner();
    // Simulates the admin email dispatch having already sent this tier --
    // clearDispatchRecords only ever reads existing stamps, it never
    // sends anything itself.
    const row = await createRow(
      partner.id,
      "newsletterCreated",
      { partnerName: partner.displayName },
      { groupmeDispatchedAt: null, biweeklyEmailDispatchSentAt: new Date() }
    );

    try {
      const { cleared } = await clearDispatchRecords();
      assert.equal(cleared, 1, "the row should clear -- GroupMe's requirement is satisfied as 'muted'");
      assert.equal(await prisma.dispatchRecord.findUnique({ where: { id: row.id } }), null);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("the same row, with the content type NOT muted, stays queued until GroupMe actually sends", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { groupme: true, outboundEmail: true },
        chatDispatchNewsletters: true,
        emailDispatchDayOfWeek: 3,
        emailDispatchHour: 9,
      },
    });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const partner = await createPartner();
    const row = await createRow(
      partner.id,
      "newsletterCreated",
      { partnerName: partner.displayName },
      { groupmeDispatchedAt: null, biweeklyEmailDispatchSentAt: new Date() }
    );

    try {
      const { cleared } = await clearDispatchRecords();
      assert.equal(cleared, 0, "GroupMe still applies and hasn't sent -- must stay queued");
      assert.ok(await prisma.dispatchRecord.findUnique({ where: { id: row.id } }));
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });
});

describe("sendUrgentDispatch", () => {
  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        postmarkServerToken: encryptField("pm-test-token"),
        emailFromAddress: "updates@example.test",
        churchName: "Hillside Community Church",
        allowRestrictedPartnerDispatch: true,
      },
    });
  });

  test("cadence-blind: reaches an admin and a confirmed public subscriber immediately, regardless of their tier having fired", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, publicDirectory: true, publicPrayerDigest: true } },
    });
    const admin = await createAdminUser({ cadence: "monthly" }); // arbitrary tier -- never checked
    const sub = await createPublicSubscriber();
    // isPublic: true -- the public email dispatch's Rule 2 also requires
    // the partner itself to be public, not just the row's type.
    const partner = await createPartner({ isPublic: true });
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "Pray for safety.",
    });

    try {
      const result = await sendUrgentDispatch(row, partner);
      assert.equal(result.emailSent, true);
      assert.equal(result.groupmePosted, false, "GroupMe is off");
      const recipients = postmarkMessages.map((m) => m.To);
      assert.ok(recipients.includes(admin.email));
      assert.ok(recipients.includes(sub.email));

      const updated = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
      assert.ok(updated.biweeklyEmailDispatchSentAt);
      assert.ok(updated.monthlyEmailDispatchSentAt);
      assert.ok(updated.quarterlyEmailDispatchSentAt);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: sub.id } });
    }
  });

  test("a one-time need's urgent send never reaches the public email dispatch, even though it's otherwise eligible", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { outboundEmail: true, publicDirectory: true, publicPrayerDigest: true } },
    });
    const admin = await createAdminUser({ cadence: "monthly" });
    const sub = await createPublicSubscriber();
    // isPublic: true -- isolates the assertion to the content-type
    // exclusion (one-time needs aren't in PUBLIC_EMAIL_DISPATCH_TYPES),
    // not the separate partner.isPublic check Rule 2 also applies.
    const partner = await createPartner({ isPublic: true });
    const row = await createRow(partner.id, "supportNeedCreated", {
      partnerName: partner.displayName,
      description: "A water filter",
      requestedAmount: 500,
    });

    try {
      const result = await sendUrgentDispatch(row, partner);
      assert.equal(result.emailSent, true);
      const recipients = postmarkMessages.map((m) => m.To);
      assert.ok(recipients.includes(admin.email));
      assert.ok(!recipients.includes(sub.email), "one-time needs are structurally admin-only");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: sub.id } });
    }
  });

  test("a muted GroupMe content type still suppresses an urgent GroupMe post, while the email side of the same row, same call, is unaffected", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { outboundEmail: true, groupme: true },
        chatDispatchPrayerRequests: false,
        groupmeAccessToken: encryptField("fake-groupme-token"),
        groupmeGroupId: "main-group",
      },
    });
    const admin = await createAdminUser({ cadence: "monthly" });
    const partner = await createPartner();
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "Pray for travel.",
    });

    try {
      const result = await sendUrgentDispatch(row, partner);
      assert.equal(result.groupmePosted, false, "muted content type must suppress GroupMe");
      assert.equal(groupmeRequests.length, 0);
      assert.equal(result.emailSent, true, "email isn't gated by GroupMe's own content-type mute");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("a restricted-and-unreviewed row never sends anywhere, even marked urgent", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { outboundEmail: true, groupme: true },
        chatDispatchPrayerRequests: true,
        groupmeAccessToken: encryptField("fake-groupme-token"),
        groupmeGroupId: "main-group",
      },
    });
    const admin = await createAdminUser({ cadence: "monthly" });
    const partner = await createPartner({ isRestricted: true });
    // Never reviewed -- dispatchReviewedAt stays null.
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "Pray for safety during relocation.",
    });

    try {
      const result = await sendUrgentDispatch(row, partner);
      assert.equal(result.groupmePosted, false);
      assert.equal(result.emailSent, false);
      assert.equal(postmarkMessages.length, 0);
      assert.equal(groupmeRequests.length, 0);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("a restricted-and-approved (reviewed at creation) row sends immediately when marked urgent", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { outboundEmail: true, groupme: true },
        chatDispatchPrayerRequests: true,
        groupmeAccessToken: encryptField("fake-groupme-token"),
        groupmeGroupId: "main-group",
      },
    });
    const admin = await createAdminUser({ cadence: "monthly" });
    const partner = await createPartner({ isRestricted: true });
    const row = await createRow(
      partner.id,
      "prayerRequestCreated",
      { partnerName: partner.displayName, requestText: "Pray for safety during relocation." },
      {
        dispatchReviewedAt: new Date(),
        dispatchReviewedById: admin.id,
        dispatchReviewedText: "Pray for safety.",
      }
    );

    try {
      const result = await sendUrgentDispatch(row, partner);
      assert.equal(result.groupmePosted, true);
      assert.equal(result.emailSent, true);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  // WhatsApp's urgent path (sendWhatsAppUrgent) is gated like GroupMe's (feature flag,
  // isEligibleForChannel, hasWhatsAppTarget); what is specific to it is that it also requires a
  // live socket (whatsappClient.getStatus().status === "connected"), which nothing in this
  // process establishes. That is the realistic state for many sendUrgentDispatch calls in
  // production (a disconnect, or WhatsApp not paired), so this confirms the short-circuit is
  // safe (no throw, posted: false). The posting/masking logic once connected is covered by
  // whatsappChannel.test.js.
  test("WhatsApp short-circuits safely (posted: false, no throw) when not actually connected, even though its target/eligibility checks pass", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        enabledFeatures: { whatsapp: true },
        chatDispatchPrayerRequests: true,
        whatsappAnnouncementGroupId: "announcements-group",
      },
    });
    const partner = await createPartner();
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "Pray for travel.",
    });

    const result = await sendUrgentDispatch(row, partner);
    assert.equal(result.whatsappPosted, false);
  });
});

describe("createDispatchRecord", () => {
  test("records nothing while no channel is on, and records once one is", async () => {
    const { createDispatchRecord } = require("../../src/utils/dispatchRecording");
    const partner = await createPartner();
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: {} } });
    assert.equal(await createDispatchRecord("newsletterCreated", partner, { partnerName: "x" }), null);
    assert.equal(await prisma.dispatchRecord.count({ where: { partnerId: partner.id } }), 0);

    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { groupme: true } },
    });
    assert.ok(await createDispatchRecord("newsletterCreated", partner, { partnerName: "x" }));
  });
});
