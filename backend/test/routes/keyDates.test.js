// Key-date reminders: the bell category, who a reminder goes to (the whole care team, else the
// missions team), what clears one, the feature gates, and the missions-team endpoints. The daily
// email is keyDateEmail.test.js.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { churchToday } = require("../../src/utils/today");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
  TEST_USERS,
} = require("./helpers");

let admin;
let editor;
let viewer;
let editorUser;
let originalEnabledFeatures;
let editorWasOnMissionsTeam;
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

async function makeGuest(tag) {
  const email = `route-test-keydate-${tag}@example.test`;
  const password = "RouteTestKeyDate123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      active: true,
      lastLoginAt: new Date(),
    },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      lastLoginAt: new Date(), // has signed in: a seat held only by an invite does not take reminders
      active: true,
    },
  });
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

// A yyyy-mm-dd that is `n` days from today (the church's day, as the app counts it, not the UTC day: the two
// differ for hours every day and a UTC-based test fails then), `yearsAgo` years back.
function dateIn(n, yearsAgo = 30) {
  const d = churchToday();
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
  const t = new Date(base);
  return `${t.getUTCFullYear() - yearsAgo}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const newPartner = async (tag) =>
  (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} kd ${tag}` },
    })
  ).body;
const addAdult = (partnerId, birthday, firstName = "Dana") =>
  admin("/api/adults", { method: "POST", body: { partnerId, firstName, lastName: "Reed", birthday } });
const category = async (who) =>
  (await who("/api/notifications/summary")).body.categories.find((c) => c.key === "keyDatesComing");

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  editorUser = await prisma.user.findUnique({ where: { email: TEST_USERS.editor.email } });
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  editorWasOnMissionsTeam = editorUser.onMissionsTeam;
  await setFeatures({ keyDates: true, careTeam: true, contactLog: true });
  // Nobody is on the missions team unless a test puts them there.
  await prisma.user.updateMany({ where: { onMissionsTeam: true }, data: { onMissionsTeam: false } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await prisma.user.updateMany({
    where: { email: TEST_USERS.editor.email },
    data: { onMissionsTeam: editorWasOnMissionsTeam === true },
  });
  await stopServer();
});

describe("key dates: who is told", () => {
  test("the whole care team sees a coming birthday on the bell; nobody else does", async () => {
    const partner = await newPartner("team");
    assert.equal((await addAdult(partner.id, dateIn(3))).status, 201);
    const lead = await makeGuest("lead");
    const member = await makeGuest("member");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: partner.id, userId: lead.user.id, isLead: true },
        { partnerId: partner.id, userId: member.user.id },
      ],
    });

    for (const who of [lead, member]) {
      const c = await category(await who.login());
      assert.equal(c.count, 1, "lead and member both get it");
      assert.equal(c.linkTo, `/admin/partners/${partner.id}`, "one partner links straight to it");
      assert.equal(c.isNew, true);
    }
    assert.equal(
      (await category(viewer)).count,
      0,
      "a login with no seat and not on the missions team sees none"
    );
  });

  test("out-of-window dates, and an adult with no birthday, are not nudged", async () => {
    const partner = await newPartner("window");
    await addAdult(partner.id, dateIn(20), "Far");
    await addAdult(partner.id, null, "NoDate");
    const who = await makeGuest("window");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    assert.equal((await category(await who.login())).count, 0);
  });

  test("children, the anniversary, and 5-year supported-since milestones count; other years don't", async () => {
    const partner = await newPartner("kinds");
    await admin(`/api/partners/${partner.id}`, {
      method: "PUT",
      body: { anniversary: dateIn(2, 12), supportingSince: dateIn(4, 5) },
    });
    await admin("/api/children", {
      method: "POST",
      body: { partnerId: partner.id, firstName: "Kid", lastName: "Reed", birthday: dateIn(1, 9) },
    });
    const who = await makeGuest("kinds");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    assert.equal((await category(await who.login())).count, 3);

    // a 3rd-year supporting-since is not a milestone
    await admin(`/api/partners/${partner.id}`, { method: "PUT", body: { supportingSince: dateIn(4, 3) } });
    assert.equal((await category(await who.login())).count, 2);
  });

  test("a logged 'key date' contact clears the reminder; any other topic does not", async () => {
    const partner = await newPartner("cleared");
    await addAdult(partner.id, dateIn(2));
    const who = await makeGuest("cleared");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const g = await who.login();
    assert.equal((await category(g)).count, 1);

    await prisma.contactLog.create({
      data: {
        partnerId: partner.id,
        contactType: "text",
        direction: "outbound",
        topics: ["checkin"],
        contactDate: new Date(),
      },
    });
    assert.equal((await category(g)).count, 1, "a plain check-in doesn't count as the card");

    const logged = await g("/api/contact-log", {
      method: "POST",
      body: { partnerId: partner.id, contactType: "card", direction: "outbound", topics: ["keydate"] },
    });
    assert.equal(logged.status, 201);
    assert.equal((await category(g)).count, 0, "the card is sent, so the reminder is done");
  });

  test("an archived partner is not nudged", async () => {
    const partner = await newPartner("archived");
    await addAdult(partner.id, dateIn(2));
    const who = await makeGuest("archived");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    await prisma.partner.update({ where: { id: partner.id }, data: { archived: true } });
    assert.equal((await category(await who.login())).count, 0);
  });
});

describe("key dates: the missions team", () => {
  test("only admins set it, admin/editor read it, and it holds only active, non-guest logins", async () => {
    assert.equal(
      (await editor("/api/partner-care/missions-team", { method: "PUT", body: { userIds: [editorUser.id] } }))
        .status,
      403
    );
    assert.equal((await viewer("/api/partner-care/missions-team")).status, 403);
    assert.deepEqual((await editor("/api/partner-care/missions-team")).body.members, []);

    const gone = await makeGuest("inactive-member");
    await prisma.user.update({ where: { id: gone.user.id }, data: { active: false } });
    assert.equal(
      (await admin("/api/partner-care/missions-team", { method: "PUT", body: { userIds: [gone.user.id] } }))
        .status,
      400,
      "an inactive login (and a guest) can't be on it"
    );

    const set = await admin("/api/partner-care/missions-team", {
      method: "PUT",
      body: { userIds: [editorUser.id] },
    });
    assert.equal(set.status, 200);
    assert.deepEqual(
      set.body.members.map((m) => m.id),
      [editorUser.id]
    );
    const read = await editor("/api/partner-care/missions-team");
    assert.deepEqual(
      read.body.members.map((m) => m.id),
      [editorUser.id]
    );
    assert.ok(read.body.candidates.every((c) => c.role !== "guest"));

    const cleared = await admin("/api/partner-care/missions-team", { method: "PUT", body: { userIds: [] } });
    assert.deepEqual(cleared.body.members, []);
  });

  test("a partner with no care team goes to the missions team; once it has one, only to the team", async () => {
    // Seeded partners have random birthdays, so some may be in the window and
    // team-less already: measure against a baseline, not against zero.
    assert.equal(
      (await category(editor)).count,
      0,
      "nobody is on the hook until someone is on the missions team"
    );
    await admin("/api/partner-care/missions-team", { method: "PUT", body: { userIds: [editorUser.id] } });
    try {
      const baseline = (await category(editor)).count;
      const partner = await newPartner("fallback");
      await addAdult(partner.id, dateIn(2));
      assert.equal(
        (await category(editor)).count,
        baseline + 1,
        "the new team-less partner is the missions team's"
      );

      const member = await makeGuest("now-covered");
      await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: member.user.id } });
      assert.equal((await category(editor)).count, baseline, "the team now has it, not the fallback");
      assert.equal((await category(await member.login())).count, 1);
    } finally {
      await admin("/api/partner-care/missions-team", { method: "PUT", body: { userIds: [] } });
    }
  });

  test("a user's own flag works too, and a guest is never on the team", async () => {
    const guest = await makeGuest("flagged");
    const res = await admin(`/api/users/${guest.user.id}`, { method: "PUT", body: { onMissionsTeam: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.onMissionsTeam, false, "a guest can't be on the missions team");
    const ed = await admin(`/api/users/${editorUser.id}`, { method: "PUT", body: { onMissionsTeam: true } });
    assert.equal(ed.body.onMissionsTeam, true);
    await admin(`/api/users/${editorUser.id}`, { method: "PUT", body: { onMissionsTeam: false } });
  });
});

describe("key dates: the list you can copy (the email-off option)", () => {
  test("lists what the email would say for the partners you look after, and says whether email is on", async () => {
    const partner = await newPartner("copylist");
    await addAdult(partner.id, dateIn(2), "Dana");
    const member = await makeGuest("copylist");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: member.user.id } });
    const g = await member.login();
    const res = await g("/api/key-dates/mine");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.emailOn, "boolean");
    assert.equal(res.body.items.length, 1);
    assert.match(res.body.items[0].when, /^In 2 days/);
    assert.match(res.body.items[0].text, /Dana Reed's birthday/);
    assert.equal(res.body.items[0].partnerId, partner.id);
    // Someone who looks after nothing gets an empty list, not an error.
    assert.deepEqual((await viewer("/api/key-dates/mine")).body.items, []);
  });

  test("reports email off, and 404s while key-date reminders are off", async () => {
    const before = (await admin("/api/settings")).body.enabledFeatures;
    await setFeatures({ outboundEmail: false });
    try {
      assert.equal((await viewer("/api/key-dates/mine")).body.emailOn, false);
    } finally {
      await setFeatures({ outboundEmail: before?.outboundEmail ?? false });
    }
    await setFeatures({ keyDates: false });
    try {
      assert.equal((await viewer("/api/key-dates/mine")).status, 404);
    } finally {
      await setFeatures({ keyDates: true });
    }
  });
});

describe("key dates: the feature gates", () => {
  test("counts nothing, and the endpoints 404, while the flags are off", async () => {
    const partner = await newPartner("gates");
    await addAdult(partner.id, dateIn(2));
    const who = await makeGuest("gates");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const g = await who.login();
    assert.equal((await category(g)).count, 1);

    await setFeatures({ keyDates: false });
    try {
      assert.equal((await category(g)).count, 0, "keyDates off");
    } finally {
      await setFeatures({ keyDates: true });
    }
    // Care teams off: seats are ignored and the missions team gets it instead.
    await setFeatures({ careTeam: false });
    await prisma.user.update({ where: { id: editorUser.id }, data: { onMissionsTeam: true } });
    try {
      // A guest whose only reach was that seat has none now: refused, and told it is paused.
      const refused = await g("/api/notifications/summary");
      assert.equal(refused.status, 403, "careTeam off: the seat is ignored");
      assert.equal(refused.body.code, "feature_paused");
      assert.ok((await category(editor)).count >= 1, "careTeam off: the missions team gets it");
      assert.equal((await admin("/api/care-team/" + partner.id)).status, 404);
    } finally {
      await prisma.user.update({ where: { id: editorUser.id }, data: { onMissionsTeam: false } });
      await setFeatures({ careTeam: true });
    }
  });
});
