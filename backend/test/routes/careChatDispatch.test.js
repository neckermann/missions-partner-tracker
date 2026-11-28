// Partner care posts for the church's chat: a coming key date, a partner nobody has heard from, and news
// waiting to be passed on. Each is its own opt-in switch, recorded once, only when a chat channel is on, never
// on a demo, masked for a restricted partner, and never in an email dispatch.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { recordCareChatDispatches } = require("../../src/utils/careChatDispatch");
const { buildBlurb } = require("../../src/utils/dispatchBlurbs");
const { churchToday } = require("../../src/utils/today");
const { CHANNELS, isEligibleForChannel } = require("../../src/utils/dispatchEligibility");

const TAG = "ZZTEST-careChat";
const MAIL = "care-chat-test";
let original;

// The church's day, as the app counts it (utils/today.js), not the UTC day, which differs for hours every day.
const dayOffset = (n) => {
  const d = churchToday();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
};
const birthdayIn = (n) => {
  const t = dayOffset(n);
  return new Date(Date.UTC(t.getUTCFullYear() - 30, t.getUTCMonth(), t.getUTCDate()));
};

async function patch(data) {
  return prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
}
const features = (extra = {}) => ({
  groupme: true,
  keyDates: true,
  careTeam: true,
  contactLog: true,
  ...extra,
});
const on = (extra = {}) =>
  patch({
    enabledFeatures: features(),
    chatDispatchKeyDates: true,
    chatDispatchQuietPartners: true,
    chatDispatchUpdatesToPass: true,
    ...extra,
  });

async function cleanup() {
  await prisma.dispatchRecord.deleteMany({});
  await prisma.careChatPost.deleteMany({});
  await prisma.partner.deleteMany({ where: { displayName: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: { contains: MAIL } } });
}

let owner;
async function makePartner(tag, extra = {}) {
  const p = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${TAG} ${tag}`, ...extra },
  });
  await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: owner.id } });
  return p;
}
const mine = async (type) =>
  (await prisma.dispatchRecord.findMany({ where: { type }, include: { partner: true } })).filter((r) =>
    r.partner.displayName.includes(TAG)
  );

before(async () => {
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await on();
  owner = await prisma.user.create({
    data: {
      email: `${MAIL}-owner@example.test`,
      firstName: "Owner",
      passwordHash: "x",
      role: "editor",
      authProvider: "local",
      active: true,
    },
  });
});

after(async () => {
  await cleanup();
  await patch({
    enabledFeatures: original?.enabledFeatures ?? {},
    chatDispatchKeyDates: original?.chatDispatchKeyDates ?? false,
    chatDispatchQuietPartners: original?.chatDispatchQuietPartners ?? false,
    chatDispatchUpdatesToPass: original?.chatDispatchUpdatesToPass ?? false,
  });
});

describe("care posts: gating", () => {
  test("nothing is recorded while every switch is off (the default)", async () => {
    await patch({
      chatDispatchKeyDates: false,
      chatDispatchQuietPartners: false,
      chatDispatchUpdatesToPass: false,
    });
    const p = await makePartner("off", { createdAt: new Date("2000-01-01") });
    await prisma.adult.create({ data: { partnerId: p.id, firstName: "Dana", birthday: birthdayIn(20) } });
    await recordCareChatDispatches();
    assert.equal((await prisma.dispatchRecord.findMany({})).length, 0);
  });

  test("nothing is recorded with no chat channel on, so no row waits for a send that can't happen", async () => {
    await patch({ enabledFeatures: features({ groupme: false, whatsapp: false }) });
    const p = await makePartner("nochat");
    await prisma.adult.create({ data: { partnerId: p.id, firstName: "Dana", birthday: birthdayIn(20) } });
    await recordCareChatDispatches();
    assert.equal((await prisma.dispatchRecord.findMany({})).length, 0);
  });

  test("a type is also off while its feature is off", async () => {
    await patch({ enabledFeatures: features({ keyDates: false }) });
    const p = await makePartner("nokd");
    await prisma.adult.create({ data: { partnerId: p.id, firstName: "Dana", birthday: birthdayIn(20) } });
    await recordCareChatDispatches();
    assert.equal((await mine("keyDateComing")).length, 0);
  });

  test("never on a public demo", async () => {
    const p = await makePartner("demo");
    await prisma.adult.create({ data: { partnerId: p.id, firstName: "Dana", birthday: birthdayIn(20) } });
    const before = process.env.DEMO_RESET_TOKEN;
    process.env.DEMO_RESET_TOKEN = "test-demo-token";
    try {
      await recordCareChatDispatches();
    } finally {
      if (before === undefined) delete process.env.DEMO_RESET_TOKEN;
      else process.env.DEMO_RESET_TOKEN = before;
    }
    assert.equal((await mine("keyDateComing")).length, 0);
  });
});

describe("care posts: key dates", () => {
  test("a date at each heads-up is recorded once, with its wording", async () => {
    const near = await makePartner("near");
    await prisma.adult.create({
      data: { partnerId: near.id, firstName: "Dana", lastName: "Reed", birthday: birthdayIn(20) },
    });
    const far = await makePartner("far");
    await prisma.adult.create({ data: { partnerId: far.id, firstName: "Sam", birthday: birthdayIn(50) } });

    const run = await recordCareChatDispatches();
    assert.ok(run.keyDateComing >= 2);
    const rows = await mine("keyDateComing");
    assert.equal(rows.length, 2);
    const blurb = buildBlurb(
      rows.find((r) => r.partner.id === near.id),
      near
    );
    assert.match(blurb.groupmeText, /Coming up for .*near: Dana Reed's birthday \(turning 30\), In 20 days/);
    assert.equal(blurb.topicKey, "groupmeCareTopicId");

    await recordCareChatDispatches();
    assert.equal((await mine("keyDateComing")).length, 2, "the same heads-up is not posted twice");
    assert.equal(await prisma.careChatPost.count({ where: { partnerId: near.id } }), 1);
  });

  test("a restricted partner's names stay out of the post", async () => {
    const p = await makePartner("restricted", { isRestricted: true });
    await prisma.adult.create({
      data: { partnerId: p.id, firstName: "Secret", lastName: "Name", birthday: birthdayIn(20) },
    });
    await patch({ allowRestrictedPartnerDispatch: true });
    await recordCareChatDispatches();
    const row = (await mine("keyDateComing"))[0];
    const blurb = buildBlurb(row, p);
    assert.ok(!blurb.groupmeText.includes("Secret"), blurb.groupmeText);
    assert.ok(!blurb.groupmeText.includes(TAG), "the real name is masked too");
    await patch({ allowRestrictedPartnerDispatch: false });
  });

  test("a restricted partner is not recorded at all when restricted dispatch is off", async () => {
    const p = await makePartner("blocked", { isRestricted: true });
    await prisma.adult.create({ data: { partnerId: p.id, firstName: "Secret", birthday: birthdayIn(20) } });
    await patch({ allowRestrictedPartnerDispatch: false });
    await recordCareChatDispatches();
    assert.equal((await mine("keyDateComing")).length, 0);
  });
});

describe("care posts: quiet partners and news to pass on", () => {
  test("a partner nobody has heard from is posted once, and a recent contact keeps them off", async () => {
    const quiet = await makePartner("quiet", { createdAt: new Date("2000-01-01") });
    const heard = await makePartner("heard", { createdAt: new Date("2000-01-01") });
    await prisma.contactLog.create({
      data: {
        partnerId: heard.id,
        contactDate: dayOffset(-3),
        contactType: "email",
        direction: "outbound",
        createdById: owner.id,
        topics: [],
      },
    });
    await recordCareChatDispatches();
    const rows = await mine("quietPartner");
    assert.deepEqual(
      rows.map((r) => r.partner.id),
      [quiet.id]
    );
    assert.match(
      buildBlurb(rows[0], quiet).groupmeText,
      /Time to reach out to .*quiet\. Nobody has logged contact/
    );
    await recordCareChatDispatches();
    assert.equal((await mine("quietPartner")).length, 1, "not posted again for the same quiet stretch");
  });

  test("an approved need nobody has passed on is posted once, and relaying it ends it", async () => {
    const p = await makePartner("news");
    const need = await prisma.supportNeed.create({
      data: {
        partnerId: p.id,
        description: "A new roof",
        requestedAmount: 500,
        requestDate: dayOffset(-5),
        approvedAmount: 500,
        approvedDate: dayOffset(-2),
      },
    });
    await recordCareChatDispatches();
    const rows = await mine("updateToPassOn");
    assert.equal(rows.length, 1);
    assert.match(
      buildBlurb(rows[0], p).groupmeText,
      /News to pass on to .*news: The church's decision on their need \(“A new roof”\)/
    );
    assert.equal(
      await prisma.careChatPost.count({ where: { partnerId: p.id, subjectKey: `need:${need.id}` } }),
      1
    );

    await recordCareChatDispatches();
    assert.equal((await mine("updateToPassOn")).length, 1);
  });
});

describe("care posts: where they go", () => {
  const row = (type) => ({ type, payload: {}, partnerId: "x" });
  const partner = { isRestricted: false, isPublic: true };

  test("each type posts to chat only while its own switch is on", () => {
    const set = {
      chatDispatchKeyDates: true,
      chatDispatchQuietPartners: false,
      chatDispatchUpdatesToPass: false,
    };
    for (const channel of [CHANNELS.GROUPME, CHANNELS.WHATSAPP]) {
      assert.equal(isEligibleForChannel(row("keyDateComing"), channel, partner, set, true), true);
      assert.equal(isEligibleForChannel(row("quietPartner"), channel, partner, set, true), false);
      assert.equal(isEligibleForChannel(row("updateToPassOn"), channel, partner, set, true), false);
    }
    assert.equal(
      isEligibleForChannel(row("keyDateComing"), CHANNELS.GROUPME, partner, {}, true),
      false,
      "off by default"
    );
  });

  test("they never ride in an email dispatch, even with every switch on", () => {
    const set = {
      chatDispatchKeyDates: true,
      chatDispatchQuietPartners: true,
      chatDispatchUpdatesToPass: true,
    };
    for (const type of ["keyDateComing", "quietPartner", "updateToPassOn"]) {
      assert.equal(isEligibleForChannel(row(type), CHANNELS.EMAIL_ADMIN, partner, set, true), false);
      assert.equal(isEligibleForChannel(row(type), CHANNELS.EMAIL_PUBLIC, partner, set, true), false);
    }
  });
});
