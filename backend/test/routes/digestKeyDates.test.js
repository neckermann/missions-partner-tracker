// Key dates in the email digest: dates inside the heads-up windows (90 / 30 days out, plus the final window)
// ride in the digest to whoever looks after the partner, each heads-up once; and the daily key-date email steps
// aside for someone whose digest reaches them first. Postmark is mocked, so nothing is sent.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { sendDigestTier } = require("../../src/utils/emailDispatchDelivery");
const { checkAndSendKeyDateReminders } = require("../../src/utils/keyDateReminderScheduler");

const realFetch = global.fetch;
let postmark = [];
global.fetch = (url, options) => {
  if (String(url).startsWith("https://api.postmarkapp.com")) {
    const sent = options?.body ? JSON.parse(options.body) : [];
    const messages = Array.isArray(sent) ? sent : [sent];
    postmark.push(...messages);
    const body = messages.map((m) => ({ ErrorCode: 0, Message: "OK", MessageID: "x", To: m.To }));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  return realFetch(url, options);
};

const TAG = "ZZTEST-digestKeyDates";
const MAIL = "digest-kd-test";
let original;

const dateIn = (n, yearsAgo = 30) => {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  return new Date(Date.UTC(t.getUTCFullYear() - yearsAgo, t.getUTCMonth(), t.getUTCDate()));
};

async function cleanup() {
  await prisma.dispatchRecord.deleteMany({});
  await prisma.partner.deleteMany({ where: { displayName: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: { contains: MAIL } } });
}

async function setup(features = {}) {
  await patchSettings({
    enabledFeatures: { outboundEmail: true, keyDates: true, careTeam: true, ...features },
    keyDateLeadDays: 7,
    keyDateAdvanceDays: [90, 30],
  });
}

async function person(tag, extra = {}) {
  return prisma.user.create({
    data: {
      email: `${MAIL}-${tag}@example.test`,
      firstName: tag,
      passwordHash: "x",
      role: "editor",
      authProvider: "local",
      lastLoginAt: new Date(), // has signed in: a seat held only by an invite does not take reminders
      active: true,
      cadence: "monthly",
      digestScope: "owned",
      ...extra,
    },
  });
}

async function partnerWith(tag, birthdayInDays, ownerId) {
  const p = await prisma.partner.create({
    data: {
      kind: "missionary",
      displayName: `${TAG} ${tag}`,
      adults: { create: [{ firstName: tag, lastName: "Reed", birthday: dateIn(birthdayInDays) }] },
    },
  });
  await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: ownerId } });
  return p;
}

const patchSettings = (data) =>
  prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
const settingsRow = () => prisma.churchSettings.findUnique({ where: { id: "singleton" } });
const mailTo = (u) => postmark.filter((m) => m.To === u.email);

before(async () => {
  original = await settingsRow();
  await cleanup();
  await patchSettings({
    postmarkServerToken: encryptField("pm-test-token"),
    emailFromAddress: "updates@example.test",
    churchName: "Hillside Community Church",
    emailDispatchDayOfMonth: null,
    emailDispatchDayOfWeek: null,
    emailDispatchHour: null,
  });
});

beforeEach(async () => {
  postmark = [];
  await cleanup();
  await prisma.keyDateReminder.deleteMany({});
  await setup();
});

after(async () => {
  global.fetch = realFetch;
  await cleanup();
  await patchSettings({
    enabledFeatures: original?.enabledFeatures ?? {},
    keyDateLeadDays: original?.keyDateLeadDays ?? 7,
    keyDateAdvanceDays: original?.keyDateAdvanceDays ?? [90, 30],
    postmarkServerToken: original?.postmarkServerToken ?? null,
    emailFromAddress: original?.emailFromAddress ?? null,
    churchName: original?.churchName ?? null,
    emailDispatchDayOfMonth: original?.emailDispatchDayOfMonth ?? null,
    emailDispatchDayOfWeek: original?.emailDispatchDayOfWeek ?? null,
    emailDispatchHour: original?.emailDispatchHour ?? null,
  });
});

describe("digest: key dates ahead", () => {
  test("a date 20 and one 50 days out ride in the digest with no other updates, once each", async () => {
    const u = await person("ahead");
    await partnerWith("Twenty", 20, u.id);
    await partnerWith("Fifty", 50, u.id);

    await sendDigestTier("monthly", await settingsRow());
    const mail = mailTo(u);
    assert.equal(mail.length, 1, "one email, though there are no partner updates at all");
    assert.match(mail[0].TextBody, /Key dates coming up/);
    assert.ok(mail[0].TextBody.includes(`${TAG} Twenty`) && mail[0].TextBody.includes(`${TAG} Fifty`));
    const tiers = (await prisma.keyDateReminder.findMany({ where: { userId: u.id } }))
      .map((r) => r.tier)
      .sort();
    assert.deepEqual(tiers, [30, 90], "each heads-up is recorded at its own threshold");

    postmark = [];
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(u).length, 0, "the next digest has nothing new to say about them");
  });

  test("a date beyond the earliest heads-up is left out", async () => {
    const u = await person("far");
    await partnerWith("Far", 120, u.id);
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(u).length, 0);
  });

  test("a date inside the final window is carried too, recorded as the final heads-up", async () => {
    const u = await person("final");
    await partnerWith("Soon", 3, u.id);
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(u).length, 1);
    const row = await prisma.keyDateReminder.findFirst({ where: { userId: u.id } });
    assert.equal(row.tier, 0);
  });

  test("it only goes to the person whose digest tier is sending, scoped to their own partners", async () => {
    const mine = await person("mine");
    const other = await person("other");
    await partnerWith("Mine", 20, mine.id);
    await partnerWith("Theirs", 20, other.id);
    await sendDigestTier("monthly", await settingsRow());
    assert.ok(mailTo(mine)[0].TextBody.includes(`${TAG} Mine`));
    assert.ok(!mailTo(mine)[0].TextBody.includes(`${TAG} Theirs`));

    postmark = [];
    await prisma.keyDateReminder.deleteMany({});
    const quarterly = await person("quarterly", { cadence: "quarterly" });
    await partnerWith("Quarterly", 20, quarterly.id);
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(quarterly).length, 0, "a quarterly person waits for the quarterly digest");
  });

  test("someone who turned key-date email off, and a digest with keyDates off, get none", async () => {
    const quiet = await person("quiet", { keyDateEmailOptOut: true });
    await partnerWith("Quiet", 20, quiet.id);
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(quiet).length, 0);

    const loud = await person("loud");
    await partnerWith("Loud", 20, loud.id);
    await setup({ keyDates: false });
    await sendDigestTier("monthly", await settingsRow());
    assert.equal(mailTo(loud).length, 0);
  });
});

describe("the daily key-date email steps aside for a digest that arrives first", () => {
  const sentTo = [];
  const send = async (m) => sentTo.push(m.to);
  beforeEach(() => (sentTo.length = 0));

  const dayFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getDate() > 28 ? null : d.getDate();
  };

  test("a person whose next digest is before the date is skipped; one with no digest is not", async () => {
    // A monthly digest tomorrow (a day 1-28 so it is a legal setting), the date in 3 days.
    let day = dayFromNow(1);
    if (!day) day = 1; // late-month: day 1 is at most ~a week away, still a legal setting for the check below
    const withDigest = await person("withdigest");
    const without = await person("without", { cadence: null });
    await partnerWith("A", 3, withDigest.id);
    await partnerWith("B", 3, without.id);
    await patchSettings({
      emailDispatchDayOfMonth: day,
      emailDispatchHour: 9,
      lastMonthlyEmailDispatchSentAt: null,
    });

    // Only meaningful when that digest really does come before the date.
    const { digestComesBefore } = require("../../src/utils/digestSchedule");
    const date = dateIn(3, 0).toISOString().slice(0, 10);
    const settings = await settingsRow();
    const expectSkip = digestComesBefore("monthly", settings, date, new Date());

    await checkAndSendKeyDateReminders({ send });
    assert.ok(sentTo.includes(without.email), "no digest: the daily email goes out");
    assert.equal(sentTo.includes(withDigest.email), !expectSkip);

    // With no schedule set there is nothing to wait for, so it goes out.
    sentTo.length = 0;
    await prisma.keyDateReminder.deleteMany({});
    await patchSettings({ emailDispatchDayOfMonth: null, emailDispatchHour: null });
    await checkAndSendKeyDateReminders({ send });
    assert.ok(sentTo.includes(withDigest.email));
  });
});
