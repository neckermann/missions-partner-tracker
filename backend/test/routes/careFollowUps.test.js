// The care follow-ups. Covers the two church timing settings (their bounds, and that the
// key-date window and the contact log's "quiet" threshold follow them), a person's own opt-out
// of the daily key-date email (the bell stays), the missions team as the fallback for "Partners
// to reach out to" (staff only), the read-time timeline of church visits and newsletters, and
// the open "updates to pass on" for a partner.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");
const { checkAndSendKeyDateReminders } = require("../../src/utils/keyDateReminderScheduler");
const { loadOpenKeyDatesFor } = require("../../src/utils/keyDateQueries");

let admin;
let editor;
let originalSettings;
const extraUsers = [];

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), ...patch };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

async function makeUser(tag, role = "guest") {
  const email = `route-test-followups-${tag}@example.test`;
  const password = "RouteTestFollow123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role, active: true, keyDateEmailOptOut: false },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role,
      authProvider: "local",
      active: true,
    },
  });
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

function dateIn(n, yearsAgo = 30) {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  return `${t.getUTCFullYear() - yearsAgo}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const daysAgo = (n) => new Date(Date.UTC(...(([y, m, d]) => [y, m, d - n])(todayParts())));
function todayParts() {
  const d = new Date();
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

const newPartner = async (tag) =>
  (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} followups ${tag}` },
    })
  ).body;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  await removeFixturePartners();
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      keyDateLeadDays: true,
      contactStaleDays: true,
    },
  });
  await setFeatures({ keyDates: true, careTeam: true, outboundEmail: true, contactLog: true });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { keyDateLeadDays: 7, contactStaleDays: 90 },
  });
  await prisma.user.updateMany({ where: { onMissionsTeam: true }, data: { onMissionsTeam: false } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      enabledFeatures: originalSettings?.enabledFeatures ?? {},
      keyDateLeadDays: originalSettings?.keyDateLeadDays ?? 7,
      contactStaleDays: originalSettings?.contactStaleDays ?? 90,
    },
  });
  await stopServer();
});

describe("the two care timings are church settings", () => {
  test("an admin sets them, within bounds, and GET /api/settings returns them", async () => {
    assert.equal((await admin("/api/settings", { method: "PUT", body: { keyDateLeadDays: 0 } })).status, 400);
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { keyDateLeadDays: 61 } })).status,
      400
    );
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { contactStaleDays: 3 } })).status,
      400
    );
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { contactStaleDays: 400 } })).status,
      400
    );
    assert.equal(
      (await editor("/api/settings", { method: "PUT", body: { keyDateLeadDays: 10 } })).status,
      403
    );
    const ok = await admin("/api/settings", {
      method: "PUT",
      body: { keyDateLeadDays: 10, contactStaleDays: 45 },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const read = await admin("/api/settings");
    assert.equal(read.body.keyDateLeadDays, 10);
    assert.equal(read.body.contactStaleDays, 45);
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { keyDateLeadDays: 7, contactStaleDays: 90 },
    });
  });

  test("the earlier key-date heads-ups are a church setting: up to three, whole days", async () => {
    const put = (keyDateAdvanceDays) =>
      admin("/api/settings", { method: "PUT", body: { keyDateAdvanceDays } });
    assert.equal((await put([90, 60, 30, 14])).status, 400, "no more than three");
    assert.equal((await put([1])).status, 400, "a day or two out is the final window's job");
    assert.equal((await put([400])).status, 400, "within a year");
    assert.equal((await put([45.5])).status, 400, "whole days");
    assert.equal((await put([120, 45])).status, 200);
    assert.deepEqual((await admin("/api/settings")).body.keyDateAdvanceDays, [120, 45]);
    assert.equal((await put([])).status, 200, "none turns the earlier heads-ups off");
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { keyDateAdvanceDays: [90, 30] },
    });
  });

  test("the key-date window follows the lead days", async () => {
    const { user } = await makeUser("lead");
    const partner = await newPartner("window");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: user.id } });
    await admin("/api/adults", {
      method: "POST",
      body: { partnerId: partner.id, firstName: "Dana", lastName: "Reed", birthday: dateIn(5) },
    });
    const forPartner = async () =>
      (await loadOpenKeyDatesFor(user.id)).filter((i) => i.partnerId === partner.id);
    try {
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { keyDateLeadDays: 7 } });
      assert.equal((await forPartner()).length, 1, "5 days away is inside a 7-day window");
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { keyDateLeadDays: 3 } });
      assert.equal((await forPartner()).length, 0, "but outside a 3-day window");
    } finally {
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { keyDateLeadDays: 7 } });
    }
  });

  test("the quiet threshold the contact log reports follows the setting", async () => {
    try {
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { contactStaleDays: 30 } });
      assert.equal((await admin("/api/contact-log/options")).body.staleDays, 30);
    } finally {
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { contactStaleDays: 90 } });
    }
    assert.equal((await admin("/api/contact-log/options")).body.staleDays, 90);
  });
});

describe("a person's own opt-out of the daily key-date email", () => {
  test("they set it from My account, and /me says so", async () => {
    const { login } = await makeUser("optout-self", "editor");
    const me = await login();
    assert.equal(
      (await me("/api/auth/key-date-email", { method: "PUT", body: { optOut: "yes" } })).status,
      400
    );
    const res = await me("/api/auth/key-date-email", { method: "PUT", body: { optOut: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.keyDateEmailOptOut, true);
    assert.equal((await me("/api/auth/me")).body.user.keyDateEmailOptOut, true);
    await me("/api/auth/key-date-email", { method: "PUT", body: { optOut: false } });
    assert.equal((await me("/api/auth/me")).body.user.keyDateEmailOptOut, false);
  });

  test("an opted-out person gets no email but keeps the bell alert, and turning it back on sends what is still due", async () => {
    const stay = await makeUser("optout-stay");
    const leave = await makeUser("optout-leave");
    const partner = await newPartner("optout");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: partner.id, userId: stay.user.id },
        { partnerId: partner.id, userId: leave.user.id },
      ],
    });
    await admin("/api/adults", {
      method: "POST",
      body: { partnerId: partner.id, firstName: "Sam", lastName: "Reed", birthday: dateIn(2) },
    });
    await prisma.user.update({ where: { id: leave.user.id }, data: { keyDateEmailOptOut: true } });

    const sent = [];
    await checkAndSendKeyDateReminders({ send: async (m) => sent.push(m) });
    // Only these two people matter (an earlier test's team member may be emailed too).
    const ours = (list) =>
      list.map((m) => m.to).filter((to) => [stay.user.email, leave.user.email].includes(to));
    assert.deepEqual(ours(sent), [stay.user.email], "only the person who didn't opt out is emailed");
    assert.equal(
      (await loadOpenKeyDatesFor(leave.user.id)).filter((i) => i.partnerId === partner.id).length,
      1,
      "the bell alert is unaffected"
    );

    await prisma.user.update({ where: { id: leave.user.id }, data: { keyDateEmailOptOut: false } });
    const again = [];
    await checkAndSendKeyDateReminders({ send: async (m) => again.push(m) });
    assert.deepEqual(
      ours(again),
      [leave.user.email],
      "back on, they get what is still due (and the first person isn't emailed twice)"
    );
  });
});

describe("the missions team is the fallback for 'Partners to reach out to'", () => {
  const setMissionsTeam = (userId, on) =>
    prisma.user.update({ where: { id: userId }, data: { onMissionsTeam: on } });

  test("a staff missions-team member is given partners with no care team; partners with a team stay with the team", async () => {
    const lead = await makeUser("mteam-staff", "editor");
    const bare = await newPartner("no-team");
    const covered = await newPartner("has-team");
    const member = await makeUser("mteam-member");
    await prisma.careTeamMember.create({ data: { partnerId: covered.id, userId: member.user.id } });
    const ids = async () =>
      (await (await lead.login())("/api/contact-log/assigned")).body.map((r) => r.partnerId);

    assert.ok(!(await ids()).includes(bare.id), "nothing before they are on the missions team");
    await setMissionsTeam(lead.user.id, true);
    try {
      const rows = (await (await lead.login())("/api/contact-log/assigned")).body;
      const bareRow = rows.find((r) => r.partnerId === bare.id);
      assert.ok(bareRow, "a partner with no care team comes to the missions team");
      assert.equal(bareRow.viaMissionsTeam, true);
      assert.ok(!rows.some((r) => r.partnerId === covered.id), "a partner with a team doesn't");
    } finally {
      await setMissionsTeam(lead.user.id, false);
    }
  });

  test("with Care teams off, the missions team looks after every partner", async () => {
    const lead = await makeUser("mteam-allpartners", "editor");
    const covered = await newPartner("covered-but-off");
    const member = await makeUser("mteam-off-member");
    await prisma.careTeamMember.create({ data: { partnerId: covered.id, userId: member.user.id } });
    await setMissionsTeam(lead.user.id, true);
    await setFeatures({ careTeam: false });
    try {
      const rows = (await (await lead.login())("/api/contact-log/assigned")).body;
      assert.ok(
        rows.some((r) => r.partnerId === covered.id && r.viaMissionsTeam),
        "seats are ignored while Care teams is off, so the missions team has it"
      );
    } finally {
      await setFeatures({ careTeam: true });
      await setMissionsTeam(lead.user.id, false);
    }
  });

  test("a guest is never given partners through the missions team", async () => {
    const guest = await makeUser("mteam-guest");
    const bare = await newPartner("no-team-guest");
    const theirs = await newPartner("guest-own");
    await prisma.careTeamMember.create({ data: { partnerId: theirs.id, userId: guest.user.id } });
    // Even with the flag forced on in the database, a guest is excluded.
    await setMissionsTeam(guest.user.id, true);
    try {
      const rows = (await (await guest.login())("/api/contact-log/assigned")).body;
      assert.ok(
        rows.some((r) => r.partnerId === theirs.id),
        "their own seat still works"
      );
      assert.ok(!rows.some((r) => r.partnerId === bare.id), "the fallback never widens a guest's reach");
    } finally {
      await setMissionsTeam(guest.user.id, false);
    }
  });
});

describe("the contact timeline: church visits and newsletters, read at request time", () => {
  test("lists visits and newsletters newest first, and follows edits to them", async () => {
    const partner = await newPartner("timeline");
    const visit = await prisma.churchVisit.create({
      data: { partnerId: partner.id, visitDate: daysAgo(10), notes: "Spoke on Sunday" },
    });
    await prisma.partnerFile.create({
      data: {
        partnerId: partner.id,
        kind: "newsletter",
        title: "November update",
        receivedDate: daysAgo(3),
        fileName: "nov.pdf",
        contentType: "application/pdf",
      },
    });
    // Not a newsletter: left out.
    await prisma.partnerFile.create({
      data: {
        partnerId: partner.id,
        kind: "signed_policy",
        receivedDate: daysAgo(1),
        fileName: "policy.pdf",
        contentType: "application/pdf",
      },
    });
    const res = await admin(`/api/contact-log/timeline?partnerId=${partner.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.events.map((e) => [e.source, e.detail]),
      [
        ["newsletter", "November update"],
        ["visit", "Spoke on Sunday"],
      ]
    );
    // Nothing was copied into the log, so deleting the source removes it from the timeline.
    assert.equal((await admin(`/api/contact-log?partnerId=${partner.id}`)).body.length, 0);
    await prisma.churchVisit.delete({ where: { id: visit.id } });
    const after = await admin(`/api/contact-log/timeline?partnerId=${partner.id}`);
    assert.deepEqual(
      after.body.events.map((e) => e.source),
      ["newsletter"]
    );
  });

  test("is open to the partner's care team and not to a trip leader or another partner's guest", async () => {
    const partner = await newPartner("timeline-access");
    const other = await newPartner("timeline-other");
    const member = await makeUser("tl-member");
    const outsider = await makeUser("tl-outsider");
    const leader = await makeUser("tl-leader");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: partner.id, userId: member.user.id },
        { partnerId: other.id, userId: outsider.user.id },
      ],
    });
    await setFeatures({ trips: true });
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, status: "planning" },
    });
    await prisma.tripAccess.create({ data: { userId: leader.user.id, tripId: trip.body.id } });
    const path = `/api/contact-log/timeline?partnerId=${partner.id}`;
    assert.equal((await (await member.login())(path)).status, 200);
    assert.equal((await (await outsider.login())(path)).status, 403);
    assert.equal((await (await leader.login())(path)).status, 403);
    assert.equal((await admin("/api/contact-log/timeline")).status, 400);
  });
});

describe("updates to pass on, for one partner", () => {
  test("lists a decided need and an answered prayer, and logging the right contact clears each", async () => {
    const partner = await newPartner("updates");
    const member = await makeUser("up-member");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: member.user.id } });
    const need = await prisma.supportNeed.create({
      data: {
        partnerId: partner.id,
        description: "Help with the move",
        requestedAmount: 500,
        requestDate: daysAgo(20),
        approvedAmount: 500,
        approvedDate: daysAgo(2),
      },
    });
    const prayer = await prisma.prayerRequest.create({
      data: {
        partnerId: partner.id,
        category: "situational",
        requestText: "Pray for the visa",
        dateReceived: daysAgo(40),
        status: "answered",
        dateAnswered: daysAgo(1),
      },
    });
    const asMember = await member.login();
    const list = async () =>
      (await asMember(`/api/contact-log/updates?partnerId=${partner.id}`)).body.updates;

    const first = await list();
    assert.deepEqual(first.map((u) => [u.kind, u.id, u.topic, u.label]).sort(), [
      ["need", need.id, "need", "Help with the move"],
      ["prayer", prayer.id, "encouragement", "Pray for the visa"],
    ]);

    // An outbound contact on the need's topic clears the need only.
    await asMember("/api/contact-log", {
      method: "POST",
      body: { partnerId: partner.id, contactType: "card", direction: "outbound", topics: ["need"] },
    });
    assert.deepEqual(
      (await list()).map((u) => u.kind),
      ["prayer"]
    );
    await asMember("/api/contact-log", {
      method: "POST",
      body: { partnerId: partner.id, contactType: "call", direction: "outbound", topics: ["encouragement"] },
    });
    assert.deepEqual(await list(), []);
  });

  test("leaves out a decided need, an answered prayer and newsletters while those features are off", async () => {
    const partner = await newPartner("updates-off");
    await prisma.supportNeed.create({
      data: {
        partnerId: partner.id,
        description: "Old need",
        requestedAmount: 100,
        requestDate: daysAgo(20),
        approvedAmount: 100,
        approvedDate: daysAgo(2),
      },
    });
    await prisma.prayerRequest.create({
      data: {
        partnerId: partner.id,
        category: "situational",
        requestText: "Old prayer",
        dateReceived: daysAgo(40),
        status: "answered",
        dateAnswered: daysAgo(1),
      },
    });
    await prisma.partnerFile.create({
      data: {
        partnerId: partner.id,
        kind: "newsletter",
        title: "Old newsletter",
        receivedDate: daysAgo(3),
        fileName: "old.pdf",
        contentType: "application/pdf",
      },
    });
    const kinds = async () =>
      (await admin(`/api/contact-log/updates?partnerId=${partner.id}`)).body.updates
        .map((u) => u.kind)
        .sort();
    const sources = async () =>
      (await admin(`/api/contact-log/timeline?partnerId=${partner.id}`)).body.events.map((e) => e.source);
    try {
      await setFeatures({ oneTimeNeeds: true, prayerRequests: true, partnerFiles: true });
      assert.deepEqual(await kinds(), ["need", "prayer"]);
      assert.deepEqual(await sources(), ["newsletter"]);

      await setFeatures({ oneTimeNeeds: false });
      assert.deepEqual(await kinds(), ["prayer"]);
      await setFeatures({ prayerRequests: false });
      assert.deepEqual(await kinds(), []);
      await setFeatures({ partnerFiles: false });
      assert.deepEqual(await sources(), []);
    } finally {
      await setFeatures({ oneTimeNeeds: true, prayerRequests: true, partnerFiles: true });
    }
  });

  test("is closed to someone with no reach to the partner", async () => {
    const partner = await newPartner("updates-closed");
    const outsider = await makeUser("up-outsider");
    const elsewhere = await newPartner("updates-elsewhere");
    await prisma.careTeamMember.create({ data: { partnerId: elsewhere.id, userId: outsider.user.id } });
    assert.equal(
      (await (await outsider.login())(`/api/contact-log/updates?partnerId=${partner.id}`)).status,
      403
    );
    assert.equal((await admin("/api/contact-log/updates")).status, 400);
  });
});
