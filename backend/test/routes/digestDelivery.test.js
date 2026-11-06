const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { sendScopedDigest } = require("../../src/utils/scopedDigest");

// Same mock-the-whole-domain technique test/routes/notifications.test.js
// and test/routes/publicSubscribe.test.js each already use for Postmark
// -- no real email ever sends in this suite. No Express server is
// started here at all -- sendScopedDigest() only ever touches Prisma and
// utils/email.js's sendEmail(), so fixtures are built directly via
// Prisma rather than through the HTTP routes those other files use.
const realFetch = global.fetch;
let postmarkCalls = [];
function mockPostmark() {
  postmarkCalls = [];
}
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    postmarkCalls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    const responseBody = { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    });
  }
  return realFetch(url, options);
};

const FIXTURE_TAG = "ZZTEST-scopedDigest";

async function cleanup() {
  await prisma.pendingNotification.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.userFollowedPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.publicSubscriberPartner.deleteMany({
    where: { partner: { displayName: { contains: FIXTURE_TAG } } },
  });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await prisma.publicSubscriber.deleteMany({ where: { email: { contains: "scoped-digest-test" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "scoped-digest-test" } } });
}

function createPartner(overrides) {
  return prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Partner`, isPublic: false, ...overrides },
  });
}

function createPendingRow(partnerId, type, payload) {
  return prisma.pendingNotification.create({ data: { partnerId, type, payload } });
}

function createAdminUser(overrides) {
  return prisma.user.create({
    data: {
      email: `scoped-digest-test-${Math.random().toString(36).slice(2)}@example.test`,
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
      email: `scoped-digest-test-${Math.random().toString(36).slice(2)}@example.test`,
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
      enabledFeatures: { outboundEmail: true },
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
      churchName: "Hillside Community Church",
      digestTemplate: null,
    },
    create: {
      id: "singleton",
      enabledFeatures: { outboundEmail: true },
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
// leak into this one's counts. Individual tests' own finally-blocks still
// clean up what they created too (defensive, not load-bearing).
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

describe("sendScopedDigest -- basic gating", () => {
  test("outboundEmail off -- returns empty, sends nothing, touches nothing", async () => {
    const settings = await getSettings();
    const result = await sendScopedDigest("weekly", {
      ...settings,
      enabledFeatures: { outboundEmail: false },
    });
    assert.deepEqual(result.consideredIds, []);
    assert.equal(postmarkCalls.length, 0);
  });

  test("no rows at all -- returns empty", async () => {
    const admin = await createAdminUser({ digestFrequency: "weekly" });
    try {
      const result = await sendScopedDigest("weekly", await getSettings());
      assert.deepEqual(result.consideredIds, []);
      assert.equal(postmarkCalls.length, 0);
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("rows exist but nobody is subscribed at this tier -- returns empty, nothing sent", async () => {
    const partner = await createPartner({});
    await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    const result = await sendScopedDigest("weekly", await getSettings());
    assert.deepEqual(result.consideredIds, []);
    assert.equal(postmarkCalls.length, 0);
  });
});

describe("sendScopedDigest -- restricted-partner review gate (#187)", () => {
  test("an unreviewed restricted partner's row never goes out to either audience", async () => {
    const partner = await createPartner({ isRestricted: true, isPublic: true });
    const admin = await createAdminUser({ digestFrequency: "weekly" });
    const subscriber = await createPublicSubscriber({ frequency: "weekly" });
    const row = await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "SECRET-UNREVIEWED-TEXT",
    });
    try {
      const result = await sendScopedDigest("weekly", await getSettings());
      assert.ok(
        !result.consideredIds.includes(row.id),
        "an unreviewed restricted row must not be considered"
      );
      assert.equal(postmarkCalls.length, 0, "neither audience should have been emailed");
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
    const admin = await createAdminUser({ digestFrequency: "weekly" });
    const subscriber = await createPublicSubscriber({ frequency: "weekly" });
    const row = await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "SECRET-ORIGINAL-TEXT",
    });
    await prisma.pendingNotification.update({
      where: { id: row.id },
      data: { reviewedAt: new Date(), reviewedById: admin.id, reviewedText: "Reviewed, safe wording." },
    });
    try {
      const result = await sendScopedDigest("weekly", await getSettings());
      assert.ok(result.consideredIds.includes(row.id));
      assert.equal(postmarkCalls.length, 2, "one email to the admin, one to the public subscriber");
      const bodies = postmarkCalls.map((c) => c.body.HtmlBody).join("\n");
      assert.ok(bodies.includes("Reviewed, safe wording."), "reviewed text should appear");
      assert.ok(!bodies.includes("SECRET-ORIGINAL-TEXT"), "original unreviewed text must never appear");
      assert.ok(!bodies.includes("Jordan") && !bodies.includes("Rivera"), "real name must never leak");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendScopedDigest -- content scope: admin vs. public audience", () => {
  test("admin gets needs and newsletters; the identical-tier public subscriber gets neither", async () => {
    const partner = await createPartner({ isPublic: true });
    const admin = await createAdminUser({ digestFrequency: "weekly" });
    const subscriber = await createPublicSubscriber({ frequency: "weekly" });
    await createPendingRow(partner.id, "supportNeedCreated", {
      partnerName: partner.displayName,
      description: "NEED-TEXT-MARKER",
    });
    await createPendingRow(partner.id, "newsletterCreated", {
      partnerName: partner.displayName,
      newsletterId: "fake-newsletter-id",
    });
    try {
      await sendScopedDigest("weekly", await getSettings());
      assert.equal(
        postmarkCalls.length,
        1,
        "only the admin should have been emailed -- neither row is prayer-request-shaped"
      );
      const html = postmarkCalls[0].body.HtmlBody;
      assert.ok(html.includes("NEED-TEXT-MARKER"), "admin should see the need");
      assert.ok(html.toLowerCase().includes("newsletter"), "admin should see the newsletter");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });

  test("a prayerRequestCreated row on a non-public partner never reaches a public subscriber, even on the same tier", async () => {
    const partner = await createPartner({ isPublic: false });
    const subscriber = await createPublicSubscriber({ frequency: "weekly" });
    await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "non-public partner prayer",
    });
    try {
      const result = await sendScopedDigest("weekly", await getSettings());
      assert.deepEqual(
        result.consideredIds,
        [],
        "nobody eligible -- non-public partner, no admin subscriber"
      );
      assert.equal(postmarkCalls.length, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendScopedDigest -- no source link for public, source link preserved for admin", () => {
  test("identical row with sourceFileId set: admin render includes a source link, public render never does", async () => {
    const partner = await createPartner({ isPublic: true });
    const admin = await createAdminUser({ digestFrequency: "weekly" });
    const subscriber = await createPublicSubscriber({ frequency: "weekly" });
    await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "a request sourced from a newsletter",
      sourceFileId: "fake-source-file-id",
    });
    try {
      await sendScopedDigest("weekly", await getSettings());
      assert.equal(postmarkCalls.length, 2);
      const adminCall = postmarkCalls.find((c) => c.body.To === admin.email);
      const publicCall = postmarkCalls.find((c) => c.body.To === subscriber.email);
      assert.ok(adminCall, "admin should have been emailed");
      assert.ok(publicCall, "public subscriber should have been emailed");
      assert.ok(
        adminCall.body.HtmlBody.includes("/api/partner-files/fake-source-file-id/download"),
        "admin render should still include the source link -- unchanged from the existing internal digest"
      );
      assert.ok(
        !publicCall.body.HtmlBody.includes("fake-source-file-id") &&
          !publicCall.body.HtmlBody.includes("partner-files"),
        "public render must never include a source link, even for the exact same underlying row"
      );
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendScopedDigest -- allPartners / scoped-partner filtering", () => {
  test("User.allPartners: false -- only followed partners' rows are included", async () => {
    const followed = await createPartner({ displayName: `${FIXTURE_TAG} Followed` });
    const notFollowed = await createPartner({ displayName: `${FIXTURE_TAG} Not Followed` });
    const admin = await createAdminUser({
      digestFrequency: "weekly",
      allPartners: false,
      followedPartners: { create: [{ partnerId: followed.id }] },
    });
    await createPendingRow(followed.id, "supportNeedCreated", {
      partnerName: followed.displayName,
      description: "FOLLOWED-NEED",
    });
    await createPendingRow(notFollowed.id, "supportNeedCreated", {
      partnerName: notFollowed.displayName,
      description: "NOT-FOLLOWED-NEED",
    });
    try {
      await sendScopedDigest("weekly", await getSettings());
      assert.equal(postmarkCalls.length, 1);
      assert.ok(postmarkCalls[0].body.HtmlBody.includes("FOLLOWED-NEED"));
      assert.ok(!postmarkCalls[0].body.HtmlBody.includes("NOT-FOLLOWED-NEED"));
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("PublicSubscriber.allPartners: false -- only scoped partners' rows are included", async () => {
    const scoped = await createPartner({ displayName: `${FIXTURE_TAG} Scoped`, isPublic: true });
    const notScoped = await createPartner({ displayName: `${FIXTURE_TAG} Not Scoped`, isPublic: true });
    const subscriber = await createPublicSubscriber({
      frequency: "weekly",
      allPartners: false,
      scopedPartners: { create: [{ partnerId: scoped.id }] },
    });
    await createPendingRow(scoped.id, "prayerRequestCreated", {
      partnerName: scoped.displayName,
      requestText: "SCOPED-PRAYER",
    });
    await createPendingRow(notScoped.id, "prayerRequestCreated", {
      partnerName: notScoped.displayName,
      requestText: "NOT-SCOPED-PRAYER",
    });
    try {
      await sendScopedDigest("weekly", await getSettings());
      assert.equal(postmarkCalls.length, 1);
      assert.ok(postmarkCalls[0].body.HtmlBody.includes("SCOPED-PRAYER"));
      assert.ok(!postmarkCalls[0].body.HtmlBody.includes("NOT-SCOPED-PRAYER"));
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });

  test("a confirmedAt: null subscriber (never confirmed) is never sent to, regardless of tier", async () => {
    const partner = await createPartner({ isPublic: true });
    const subscriber = await createPublicSubscriber({ frequency: "weekly", confirmedAt: null });
    await createPendingRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "unconfirmed test",
    });
    try {
      const result = await sendScopedDigest("weekly", await getSettings());
      assert.deepEqual(result.consideredIds, []);
      assert.equal(postmarkCalls.length, 0);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});
