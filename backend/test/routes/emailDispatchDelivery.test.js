const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { sendDigestTier } = require("../../src/utils/emailDispatchDelivery");
const { runEmailDispatchTier } = require("../../src/utils/emailDispatchScheduler");

// Same mock-the-whole-domain technique as dispatches.test.js and publicSubscribe.test.js for
// Postmark; no real email ever sends. No Express server is started: sendDigestTier() only
// touches Prisma and utils/email.js's sendEmailBatch(), so fixtures are built directly via
// Prisma. sendEmailBatch sends every recipient's message in ONE call to POST /email/batch (an
// array body); the mock flattens every batch into one list of messages (`postmarkMessages`) so
// assertions can reason per recipient.
const realFetch = global.fetch;
let postmarkMessages = [];
// Addresses the fake Postmark rejects (an inactive recipient, a bad address): only these fail.
let rejectedAddresses = new Set();
function mockPostmark() {
  postmarkMessages = [];
  rejectedAddresses = new Set();
}
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    const sent = options?.body ? JSON.parse(options.body) : [];
    const messages = Array.isArray(sent) ? sent : [sent];
    postmarkMessages.push(...messages);
    const responseBody = messages.map((m) =>
      rejectedAddresses.has(m.To)
        ? { ErrorCode: 406, Message: "Inactive recipient", To: m.To }
        : {
            ErrorCode: 0,
            Message: "OK",
            MessageID: "fake-id",
            SubmittedAt: "2026-01-01T00:00:00Z",
            To: m.To,
          }
    );
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
  // Unconditional, not scoped to this file's fixture partners: sendDigestTier() processes the
  // entire DispatchRecord queue by design, so any leftover row (seed data, another test file)
  // would leak into every exact-count assertion. Safe because this is the test database only and
  // tests run with --test-concurrency=1.
  await prisma.dispatchRecord.deleteMany({});
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
      digestScope: "all",
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

// Every test here uses tier "biweekly", the seeded demo admin's default cadence (allPartners:
// true), so unless neutralized it is an eligible recipient for every row any test creates, the
// same leak as the unscoped DispatchRecord rows above. Captured and restored like
// ChurchSettings.enabledFeatures in reports.test.js/collections.test.js, since this is shared
// global state too.
let originalUserCadences;

before(async () => {
  originalUserCadences = await prisma.user.findMany({ select: { id: true, cadence: true } });
  await prisma.user.updateMany({ data: { cadence: null } });
  await cleanup();
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: { outboundEmail: true, publicDirectory: true, publicPrayerDigest: true },
      // Defaults off; this file's restricted-partner review-gate tests need it on, so it is set
      // explicitly rather than relying on the schema default.
      allowRestrictedPartnerDispatch: true,
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
      churchName: "Hillside Community Church",
      emailDispatchLayout: null,
    },
    create: {
      id: "singleton",
      enabledFeatures: { outboundEmail: true, publicDirectory: true, publicPrayerDigest: true },
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
  await Promise.all(
    originalUserCadences.map((u) =>
      prisma.user.update({ where: { id: u.id }, data: { cadence: u.cadence } }).catch(() => {})
    )
  );
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: {}, postmarkServerToken: null, emailFromAddress: null, churchName: null },
  });
});

// B1 of the November 2026 app review: a digest that failed to send used to be stamped as sent anyway
// (and its error note cleared), so a church whose email was misconfigured lost those updates silently.
// G14b: the provider failing outright part-way through a digest of more than 250 recipients used to throw out of
// the pass after the first 250 had already been sent, leaving nothing marked, so the next minute sent them again.
describe("a digest the provider fails part-way through", () => {
  const now = new Date("2026-06-01T09:00:00Z");
  async function bigDigest() {
    const partner = await createPartner({});
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "part-way",
    });
    const admins = await Promise.all(
      Array.from({ length: 251 }, () => createAdminUser({ cadence: "biweekly" }))
    );
    return { row, admins };
  }
  // Postmark's batch call number `failCall` (1-based) answers with an outage; the others succeed.
  async function withOutageOnCall(failCall, run) {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = (url, options) => {
      if (String(url).startsWith("https://api.postmarkapp.com")) {
        calls += 1;
        if (calls === failCall) {
          const body = { ErrorCode: 300, Message: "Provider unavailable" };
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => body,
            text: async () => JSON.stringify(body),
          });
        }
      }
      return originalFetch(url, options);
    };
    try {
      await run();
    } finally {
      global.fetch = originalFetch;
    }
  }
  const tier = async () =>
    runEmailDispatchTier(
      "biweekly",
      "biweeklyEmailDispatchSentAt",
      "lastBiweeklyEmailDispatchSentAt",
      await getSettings(),
      now
    );

  test("when the second batch fails, the first 250 are not sent again: the row is marked and the tier is done", async () => {
    const { row, admins } = await bigDigest();
    try {
      await withOutageOnCall(2, async () => {
        await tier();
      });
      const after = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
      assert.ok(after.biweeklyEmailDispatchSentAt, "it reached people, so it is marked");
      assert.match(after.emailError, /Provider error/, "and the failure stays visible to admins");
      const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
      assert.ok(
        settings.lastBiweeklyEmailDispatchSentAt,
        "the tier's last-sent time moves on, so it is not run again"
      );
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: admins.map((a) => a.id) } } });
    }
  });

  test("when the very first batch fails nothing went out, so the pass stops and nothing is marked", async () => {
    const { row, admins } = await bigDigest();
    try {
      await withOutageOnCall(1, async () => {
        await assert.rejects(() => tier());
      });
      const after = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
      assert.equal(after.biweeklyEmailDispatchSentAt, null, "so the next minute tries the whole pass again");
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: admins.map((a) => a.id) } } });
    }
  });
});

describe("a digest whose send failed is not marked as sent", () => {
  async function setup({ failFor = [] } = {}) {
    const partner = await createPartner({});
    const a = await createAdminUser({ cadence: "biweekly" });
    const b = await createAdminUser({ cadence: "biweekly" });
    const row = await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    rejectedAddresses = new Set(failFor.map((u) => ({ a, b })[u].email));
    return { row, a, b };
  }
  const now = new Date("2026-06-01T09:00:00Z");

  test("sendDigestTier: a row every send failed for is not delivered, and says it failed", async () => {
    const { row } = await setup({ failFor: ["a", "b"] });
    const result = await sendDigestTier("biweekly", await getSettings());
    assert.deepEqual(result.deliveredIds, []);
    assert.deepEqual(result.failedIds, [row.id]);
    assert.equal(
      (await prisma.dispatchRecord.findUnique({ where: { id: row.id } })).emailError,
      "Inactive recipient"
    );
  });

  test("sendDigestTier: a row that reached one recipient is delivered, and still notes the other's failure", async () => {
    const { row } = await setup({ failFor: ["b"] });
    const result = await sendDigestTier("biweekly", await getSettings());
    assert.deepEqual(result.deliveredIds, [row.id]);
    assert.deepEqual(result.failedIds, [row.id]);
  });

  test("the scheduled pass leaves a row unstamped when every send failed, and keeps its error", async () => {
    const { row } = await setup({ failFor: ["a", "b"] });
    await runEmailDispatchTier(
      "biweekly",
      "biweeklyEmailDispatchSentAt",
      "lastBiweeklyEmailDispatchSentAt",
      await getSettings(),
      now
    );
    const after = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.equal(after.biweeklyEmailDispatchSentAt, null, "not stamped, so the next pass tries again");
    assert.equal(after.emailError, "Inactive recipient", "the failure stays visible to admins");
  });

  test("the scheduled pass stamps a row that reached someone, and keeps the error for the one that failed", async () => {
    const { row } = await setup({ failFor: ["b"] });
    await runEmailDispatchTier(
      "biweekly",
      "biweeklyEmailDispatchSentAt",
      "lastBiweeklyEmailDispatchSentAt",
      await getSettings(),
      now
    );
    const after = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.ok(after.biweeklyEmailDispatchSentAt, "delivered to at least one person");
    assert.equal(after.emailError, "Inactive recipient");
  });

  test("a clean send stamps the row and clears an old error", async () => {
    const { row } = await setup();
    await prisma.dispatchRecord.update({ where: { id: row.id }, data: { emailError: "an earlier failure" } });
    await runEmailDispatchTier(
      "biweekly",
      "biweeklyEmailDispatchSentAt",
      "lastBiweeklyEmailDispatchSentAt",
      await getSettings(),
      now
    );
    const after = await prisma.dispatchRecord.findUnique({ where: { id: row.id } });
    assert.ok(after.biweeklyEmailDispatchSentAt);
    assert.equal(after.emailError, null);
  });
});

// RFC 8058 one-click unsubscribe: a mail client that supports it shows a native "Unsubscribe"
// button that POSTs straight to the unsubscribe URL, no page shown. Requires both headers
// together (some clients won't trust List-Unsubscribe alone).
describe("sendDigestTier -- List-Unsubscribe headers (#327 Finding 6)", () => {
  test("an admin digest recipient's message carries both headers, with the real unsubscribe URL", async () => {
    const partner = await createPartner({});
    const admin = await createAdminUser({ cadence: "biweekly" });
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      assert.equal(postmarkMessages.length, 1);
      const headers = postmarkMessages[0].Headers;
      assert.ok(Array.isArray(headers));
      const listUnsub = headers.find((h) => h.Name === "List-Unsubscribe");
      const listUnsubPost = headers.find((h) => h.Name === "List-Unsubscribe-Post");
      assert.ok(listUnsub, "List-Unsubscribe header must be present");
      assert.match(listUnsub.Value, /^<.*\/api\/auth\/unsubscribe\?token=.+>$/);
      assert.equal(listUnsubPost?.Value, "List-Unsubscribe=One-Click");
    } finally {
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  test("a public subscriber's message carries both headers, with the subscriber unsubscribe URL", async () => {
    const partner = await createPartner({ isPublic: true });
    const subscriber = await createPublicSubscriber({ cadence: "biweekly" });
    await createRow(partner.id, "prayerRequestCreated", {
      partnerName: partner.displayName,
      requestText: "pray",
    });
    try {
      const settings = await getSettings();
      await sendDigestTier("biweekly", {
        ...settings,
        enabledFeatures: { ...settings.enabledFeatures, publicPrayerDigest: true },
      });
      assert.equal(postmarkMessages.length, 1);
      const headers = postmarkMessages[0].Headers;
      const listUnsub = headers.find((h) => h.Name === "List-Unsubscribe");
      assert.match(listUnsub.Value, /^<.*\/api\/public\/unsubscribe\?token=.+>$/);
    } finally {
      await prisma.publicSubscriber.delete({ where: { id: subscriber.id } });
    }
  });
});

describe("sendDigestTier -- basic gating", () => {
  test("outboundEmail off -- returns empty, sends nothing, touches nothing", async () => {
    const settings = await getSettings();
    const result = await sendDigestTier("biweekly", {
      ...settings,
      enabledFeatures: { outboundEmail: false },
    });
    assert.deepEqual(result.deliveredIds, []);
    assert.equal(postmarkMessages.length, 0);
  });

  test("no rows at all -- returns empty", async () => {
    const admin = await createAdminUser({ cadence: "biweekly" });
    try {
      const result = await sendDigestTier("biweekly", await getSettings());
      assert.deepEqual(result.deliveredIds, []);
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
    assert.deepEqual(result.deliveredIds, []);
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
      assert.ok(result.deliveredIds.includes(row.id), "admin digest should still stamp this row");
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
      assert.ok(!result.deliveredIds.includes(row.id), "an unreviewed restricted row must not be considered");
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
      assert.ok(result.deliveredIds.includes(row.id));
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
      assert.deepEqual(result.deliveredIds, [], "nobody eligible -- non-public partner, no admin subscriber");
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
  test('User.digestScope "followed" -- only followed partners\' rows are included', async () => {
    const followed = await createPartner({ displayName: `${FIXTURE_TAG} Followed` });
    const notFollowed = await createPartner({ displayName: `${FIXTURE_TAG} Not Followed` });
    const admin = await createAdminUser({
      cadence: "biweekly",
      digestScope: "followed",
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

  test('User.digestScope "owned" -- the partners they look after: their care team seats, plus teamless partners for the missions team', async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...((await getSettings()).enabledFeatures || {}), careTeam: true } },
    });
    const seated = await createPartner({ displayName: `${FIXTURE_TAG} Seated` });
    const teamless = await createPartner({ displayName: `${FIXTURE_TAG} Teamless` });
    const other = await createPartner({ displayName: `${FIXTURE_TAG} Other Team` });
    const teammate = await createAdminUser({ cadence: null });
    await prisma.careTeamMember.create({ data: { partnerId: other.id, userId: teammate.id } });
    const member = await createAdminUser({ cadence: "biweekly", digestScope: "owned" });
    await prisma.careTeamMember.create({ data: { partnerId: seated.id, userId: member.id } });
    const missions = await createAdminUser({
      cadence: "biweekly",
      digestScope: "owned",
      onMissionsTeam: true,
    });
    for (const [p, text] of [
      [seated, "SEATED-NEED"],
      [teamless, "TEAMLESS-NEED"],
      [other, "OTHER-TEAM-NEED"],
    ]) {
      await createRow(p.id, "supportNeedCreated", { partnerName: p.displayName, description: text });
    }
    try {
      await sendDigestTier("biweekly", await getSettings());
      const bodyFor = (user) => postmarkMessages.find((m) => m.To === user.email)?.HtmlBody || "";
      const memberBody = bodyFor(member);
      assert.ok(memberBody.includes("SEATED-NEED"), "their own partner");
      assert.ok(
        !memberBody.includes("TEAMLESS-NEED"),
        "a teamless partner is the missions team's, not theirs"
      );
      assert.ok(!memberBody.includes("OTHER-TEAM-NEED"));
      const missionsBody = bodyFor(missions);
      assert.ok(missionsBody.includes("TEAMLESS-NEED"), "the missions team looks after teamless partners");
      assert.ok(!missionsBody.includes("SEATED-NEED"), "a partner with a team isn't the missions team's");
      assert.ok(!missionsBody.includes("OTHER-TEAM-NEED"));
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [teammate.id, member.id, missions.id] } } });
    }
  });

  test("a care team guest's digest holds only their own partner, whatever scope is stored", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...((await getSettings()).enabledFeatures || {}), careTeam: true } },
    });
    const mine = await createPartner({ displayName: `${FIXTURE_TAG} Guest Own` });
    const notMine = await createPartner({ displayName: `${FIXTURE_TAG} Guest Not Own` });
    // "all" is stored on purpose: a guest's digest is forced to their own partners at send time.
    const guest = await createAdminUser({ role: "guest", cadence: "biweekly", digestScope: "all" });
    await prisma.careTeamMember.create({ data: { partnerId: mine.id, userId: guest.id } });
    await createRow(mine.id, "supportNeedCreated", {
      partnerName: mine.displayName,
      description: "GUEST-OWN-NEED",
    });
    await createRow(notMine.id, "supportNeedCreated", {
      partnerName: notMine.displayName,
      description: "GUEST-NOT-OWN-NEED",
    });
    try {
      await sendDigestTier("biweekly", await getSettings());
      const body = postmarkMessages.find((m) => m.To === guest.email)?.HtmlBody || "";
      assert.ok(body.includes("GUEST-OWN-NEED"));
      assert.ok(!body.includes("GUEST-NOT-OWN-NEED"), "a guest never gets another partner's content");
    } finally {
      await prisma.user.delete({ where: { id: guest.id } });
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
      assert.deepEqual(result.deliveredIds, []);
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
