const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { sendDigestTier } = require("../../src/utils/emailDispatchDelivery");

// Same mock-the-whole-domain technique test/routes/dispatches.test.js
// and test/routes/publicSubscribe.test.js each already use for Postmark
// -- no real email ever sends in this suite. No Express server is
// started here at all -- sendDigestTier() only ever touches Prisma and
// utils/email.js's sendEmailBatch(), so fixtures are built directly via
// Prisma rather than through the HTTP routes those other files use.
//
// sendEmailBatch sends every recipient's message in ONE call to
// POST /email/batch (an array body), not one call per recipient -- the
// mock below flattens every batch call's array into one list of
// individual messages (`postmarkMessages`) so assertions below can
// still reason per-recipient without caring how many underlying HTTP
// calls that took.
const realFetch = global.fetch;
let postmarkMessages = [];
function mockPostmark() {
  postmarkMessages = [];
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
  return realFetch(url, options);
};

const FIXTURE_TAG = "ZZTEST-emailDispatchDelivery";

async function cleanup() {
  await prisma.dispatchRecord.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.userFollowedPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.publicSubscriberPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: "digest-delivery-test" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "digest-delivery-test" } } });
}

function createPartner(overrides) {
  return prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Partner`, isPublic: false, ...overrides },
  });
}

function createRow(partnerId, type, payload) {
  return prisma.dispatchRecord.create({ data: { partnerId, type, payload } });
}

function createAdminUser(overrides) {
  return prisma.user.create({
    data: {
      email: `digest-delivery-test-${Math.random().toString(36).slice(2)}@example.test`,
      role: "editor",
      active: true,
      allPartners: true,
      ...overrides,
    },
  });
}

function createPublicSubscriber(overrides) {
  return prisma.publicSubscriber.create({
    data: {
      email: `digest-delivery-test-${Math.random().toString(36).slice(2)}@example.test`,
      confirmedAt: new Date(),
      allPartners: true,
      ...overrides,
    },
  });
}

async function getSettings() {
  return prisma.churchSettings.findUnique({ where: { id: "singleton" } });
}

before(async () => {
  await cleanup();
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: { outboundEmail: true, publicPrayerDigest: true },
      // Defaults off now -- this file's own restricted-partner review-gate
      // tests need it on, same as dispatches.test.js/groupme.test.js
      // already set explicitly rather than relying on the schema default.
      allowRestrictedPartnerDispatch: true,
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
      churchName: "Hillside Community Church",
      emailDispatchLayout: null,
    },
    create: {
      id: "singleton",
      enabledFeatures: { outboundEmail: true, publicPrayerDigest: true },
      allowRestrictedPartnerDispatch: true,
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
      churchName: "Hillside Community Church",
    },
  });
});

// Full isolation between tests, not just Postmark-call reset -- an
// allPartners: true recipient (the default for both helpers above) sees
// *every* fixture row still in the table, not just the one its own test
// created, so a prior test's row/partner left behind would otherwise
// leak into this one's counts.
beforeEach(async () => {
  mockPostmark();
  await cleanup();
});

after(async () => {
  global.fetch = realFetch;
  await cleanup();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: {}, postmarkServerToken: null, emailFromAddress: null, churchName: null },
  });
});

describe("sendDigestTier -- basic gating", () => {
  test("outboundEmail off -- returns empty, sends nothing, touches nothing", async () => {
    const settings = await getSettings();
    const result = await sendDigestTier("biweekly", {
      ...settings,
      enabledFeatures: { outboundEmail: false },
    });
    assert.deepEqual(result.consideredIds, []);
    assert.equal(postmarkMessages.length, 0);
  });

  test("no rows at all -- returns empty", async () => {
    const admin = await createAdminUser({ cadence: "biweekly" });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.deepEqual(result.consideredIds, []);
      assert.equal(postmarkMessages.length, 0);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("rows exist but nobody is subscribed at this tier -- returns empty, nothing sent", async () => {
    const partner = await createPartner({});
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    const result = await sendDigestTier("biweekly", await getSettings());
    assert.deepEqual(result.consideredIds, []);
    assert.equal(postmarkMessages.length, 0);
  });

  test("publicPrayerDigest off -- a confirmed public subscriber gets nothing, even though outboundEmail is on and the admin digest still sends", async () => {
    const partner = await createPartner({ isPublic: true });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    try {
      const settings = await getSettings();
      const result = await sendDigestTier("biweekly", {
        ...settings,
        enabledFeatures: { outboundEmail: true, publicPrayerDigest: false },
      });
      assert.ok(result.consideredIds.includes(row.id), "admin digest should still stamp this row");
      assert.equal(postmarkMessages.length, 1, "only the admin should have been emailed");
      assert.equal(postmarkMessages[0].To, admin.email);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- restricted-partner review gate (#187)", () => {
  test("an unreviewed restricted partner's row never goes out to either audience", async () => {
    const partner = await createPartner({ isRestricted: true, isPublic: true });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "SECRET-UNREVIEWED-TEXT",
    });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.ok(
        !result.consideredIds.includes(row.id),
        "an unreviewed restricted row must not be considered"
      );
      assert.equal(postmarkMessages.length, 0, "neither audience should have been emailed");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });

  test("once reviewed, it goes out to both audiences with the reviewed text, still masked", async () => {
    const partner = await createPartner({
      isRestricted: true,
      isPublic: true,
      displayName: `${FIXTURE_TAG} Jordan Rivera`,
    });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "SECRET-ORIGINAL-TEXT",
    });
    await prisma.dispatchRecord.update({
      where: { id: row.id },
      data: {
        dispatchReviewedAt: new Date(),
        dispatchReviewedById: admin.id,
        dispatchReviewedText: "Reviewed, safe wording.",
      },
    });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.ok(result.consideredIds.includes(row.id));
      assert.equal(postmarkMessages.length, 2, "one email to the admin, one to the public subscriber");
      const bodies = postmarkMessages.map((m) => m.HtmlBody).join("\n");
      assert.ok(bodies.includes("Reviewed, safe wording."), "reviewed text should appear");
      assert.ok(!bodies.includes("SECRET-ORIGINAL-TEXT"), "original unreviewed text must never appear");
      assert.ok(!bodies.includes("Jordan") && !bodies.includes("Rivera"), "real name must never leak");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- content scope: admin vs. public audience", () => {
  test("admin gets needs and newsletters; the identical-tier public subscriber gets neither", async () => {
    const partner = await createPartner({ isPublic: true });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    await createRow(partner.id, "supportNeedCreated", {
      partnerName: partner.displayName,
      description: "NEED-TEXT-MARKER",
    });
    await createRow(partner.id, "newsletterCreated", {
      partnerName: partner.displayName,
      newsletterId: "fake-newsletter-id",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(
        postmarkMessages.length,
        1,
        "only the admin should have been emailed -- neither row is prayer-request-shaped"
      );
      const html = postmarkMessages[0].HtmlBody;
      assert.ok(html.includes("NEED-TEXT-MARKER"), "admin should see the need");
      assert.ok(html.toLowerCase().includes("newsletter"), "admin should see the newsletter");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });

  test("a prayerRequestCreated row on a non-public partner never reaches a public subscriber, even on the same tier", async () => {
    const partner = await createPartner({ isPublic: false });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "non-public partner prayer",
    });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.deepEqual(
        result.consideredIds,
        [],
        "nobody eligible -- non-public partner, no admin subscriber"
      );
      assert.equal(postmarkMessages.length, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- no source link for public, source link preserved for admin", () => {
  test("identical row with sourceFileId set: admin render includes a source link, public render never does", async () => {
    const partner = await createPartner({ isPublic: true });
    const admin = await createAdminUser({ cadence: "biweekly" });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "a request sourced from a newsletter",
      sourceFileId: "fake-source-file-id",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(postmarkMessages.length, 2);
      const adminMessage = postmarkMessages.find((m) => m.To === admin.email);
      const publicMessage = postmarkMessages.find((m) => m.To === subscriber.email);
      assert.ok(adminMessage, "admin should have been emailed");
      assert.ok(publicMessage, "public subscriber should have been emailed");
      assert.ok(
        adminMessage.HtmlBody.includes("/api/partner-files/fake-source-file-id/download"),
        "admin render should still include the source link -- unchanged from the existing internal digest"
      );
      assert.ok(
        !publicMessage.HtmlBody.includes("fake-source-file-id") &&
          !publicMessage.HtmlBody.includes("partner-files"),
        "public render must never include a source link, even for the exact same underlying row"
      );
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- allPartners / scoped-partner filtering", () => {
  test("User.allPartners: false -- only followed partners' rows are included", async () => {
    const followed = await createPartner({ displayName: `${FIXTURE_TAG} Followed` });
    const notFollowed = await createPartner({ displayName: `${FIXTURE_TAG} Not Followed` });
    const admin = await createAdminUser({
      cadence: "biweekly",
      allPartners: false,
      followedPartners: { create: [{ partnerId: followed.id }] },
    });
    await createRow(followed.id, "supportNeedCreated", {
      partnerName: followed.displayName,
      description: "FOLLOWED-NEED",
    });
    await createRow(notFollowed.id, "supportNeedCreated", {
      partnerName: notFollowed.displayName,
      description: "NOT-FOLLOWED-NEED",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(postmarkMessages.length, 1);
      assert.ok(postmarkMessages[0].HtmlBody.includes("FOLLOWED-NEED"));
      assert.ok(!postmarkMessages[0].HtmlBody.includes("NOT-FOLLOWED-NEED"));
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("PublicSubscriber.allPartners: false -- only scoped partners' rows are included", async () => {
    const scoped = await createPartner({ displayName: `${FIXTURE_TAG} Scoped`, isPublic: true });
    const notScoped = await createPartner({ displayName: `${FIXTURE_TAG} Not Scoped`, isPublic: true });
    const subscriber = await createPublicSubscriber({
      cadence: "biweekly",
      allPartners: false,
      scopedPartners: { create: [{ partnerId: scoped.id }] },
    });
    await createRow(scoped.id, "prayerRequestCreated", {
      partnerName: scoped.displayName,
      requestText: "SCOPED-PRAYER",
    });
    await createRow(notScoped.id, "prayerRequestCreated", {
      partnerName: notScoped.displayName,
      requestText: "NOT-SCOPED-PRAYER",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(postmarkMessages.length, 1);
      assert.ok(postmarkMessages[0].HtmlBody.includes("SCOPED-PRAYER"));
      assert.ok(!postmarkMessages[0].HtmlBody.includes("NOT-SCOPED-PRAYER"));
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });

  test("a confirmedAt: null subscriber (never confirmed) is never sent to, regardless of tier", async () => {
    const partner = await createPartner({ isPublic: true });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly", confirmedAt: null });
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "unconfirmed test",
    });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.deepEqual(result.consideredIds, []);
      assert.equal(postmarkMessages.length, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- batching", () => {
  test("more than 250 eligible recipients are sent in multiple batch calls, not one giant call", async () => {
    const partner = await createPartner({});
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "batching test",
    });
    const admins = await Promise.all(
      Array.from({ length: 251 }, () => createAdminUser({ cadence: "biweekly" }))
    );
    const batchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = (url, options) => {
      if (String(url).startsWith("https://api.postmarkapp.com")) {
        batchCalls.push(JSON.parse(options.body).length);
      }
      return originalFetch(url, options);
    };
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(batchCalls.length, 2, "251 recipients -> 2 batch calls");
      assert.equal(batchCalls[0], 250);
      assert.equal(batchCalls[1], 1);
    } finally {
      global.fetch = originalFetch;
      await prisma.user.deleteMany({ where: { id: { in: admins.map((a) => a.id) } } });
    }
  });
});
