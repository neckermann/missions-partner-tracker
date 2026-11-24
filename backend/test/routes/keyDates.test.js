// #291: key-date reminders -- the bell category, who a reminder goes to (the
// whole care team, else the default lead), what clears one, the feature gates,
// and the default-lead endpoints. The daily email is keyDateEmail.test.js.
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
  TEST_USERS,
} = require("./helpers");

let admin;
let editor;
let viewer;
let editorUser;
let originalEnabledFeatures;
let originalDefaultLead;
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
    update: { passwordHash: await bcrypt.hash(password, 4), role: "guest", active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

// A yyyy-mm-dd that is `n` days from today (UTC), `yearsAgo` years back.
function dateIn(n, yearsAgo = 30) {
  const d = new Date();
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
    select: { enabledFeatures: true, defaultCareLeadUserId: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  originalDefaultLead = settings?.defaultCareLeadUserId ?? null;
  await setFeatures({ keyDates: true, careTeam: true, contactLog: true });
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { defaultCareLeadUserId: null } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures, defaultCareLeadUserId: originalDefaultLead },
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
      "a login with no seat and no default-lead role sees none"
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

describe("key dates: the default lead", () => {
  test("only admins set it, admin/editor read it, and it needs an active login", async () => {
    assert.equal(
      (await editor("/api/care-team/default-lead", { method: "PUT", body: { userId: editorUser.id } }))
        .status,
      403
    );
    assert.equal((await viewer("/api/care-team/default-lead")).status, 403);
    assert.deepEqual((await editor("/api/care-team/default-lead")).body, { defaultLead: null });

    const gone = await makeGuest("inactive-lead");
    await prisma.user.update({ where: { id: gone.user.id }, data: { active: false } });
    assert.equal(
      (await admin("/api/care-team/default-lead", { method: "PUT", body: { userId: gone.user.id } })).status,
      400
    );

    const set = await admin("/api/care-team/default-lead", {
      method: "PUT",
      body: { userId: editorUser.id },
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.defaultLead.userId, editorUser.id);
    assert.equal((await editor("/api/care-team/default-lead")).body.defaultLead.userId, editorUser.id);

    const cleared = await admin("/api/care-team/default-lead", { method: "PUT", body: { userId: null } });
    assert.deepEqual(cleared.body, { defaultLead: null });
  });

  test("a partner with no care team goes to the default lead; once it has one, only to the team", async () => {
    // Seeded partners have random birthdays, so some may be in the window and
    // team-less already: measure against a baseline, not against zero.
    assert.equal((await category(editor)).count, 0, "nobody is on the hook until a default lead is set");
    await admin("/api/care-team/default-lead", { method: "PUT", body: { userId: editorUser.id } });
    try {
      const baseline = (await category(editor)).count;
      const partner = await newPartner("fallback");
      await addAdult(partner.id, dateIn(2));
      assert.equal(
        (await category(editor)).count,
        baseline + 1,
        "the new team-less partner is the default lead's"
      );

      const member = await makeGuest("now-covered");
      await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: member.user.id } });
      assert.equal((await category(editor)).count, baseline, "the team now has it, not the fallback");
      assert.equal((await category(await member.login())).count, 1);
    } finally {
      await admin("/api/care-team/default-lead", { method: "PUT", body: { userId: null } });
    }
  });

  test("deleting the default lead's login clears the setting", async () => {
    const lead = await makeGuest("doomed-lead");
    await admin("/api/care-team/default-lead", { method: "PUT", body: { userId: lead.user.id } });
    await prisma.user.delete({ where: { id: lead.user.id } });
    assert.deepEqual((await admin("/api/care-team/default-lead")).body, { defaultLead: null });
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
    await setFeatures({ careTeam: false });
    try {
      assert.equal((await category(admin)).count, 0, "careTeam off: no recipients");
      assert.equal((await admin("/api/care-team/default-lead")).status, 404);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });
});
