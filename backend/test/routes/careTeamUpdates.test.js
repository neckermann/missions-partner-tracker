// #292 Phase 1: what flows to a partner's care team. The app never contacts a
// partner -- a person does -- so the team is told (bell), and an "update to pass
// on" (a need decision, an answered prayer) clears only when they log an
// OUTBOUND contact. Covers: a care team guest's new-need/prayer notifications
// scoped to their own partners, updatesToPassOn, and the auto-log when a care
// team member marks a prayer answered.
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

let admin;
let originalEnabledFeatures;
let partnerA;
let partnerB;
let member; // guest on partnerA's care team
let tripLeader; // guest with only a trip grant on partnerA
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
  const email = `route-test-updates-${tag}@example.test`;
  const password = "RouteTestUpdates123!";
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

// yyyy-mm-dd, `n` days from today (UTC)
const dayStr = (n = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
    .toISOString()
    .slice(0, 10);
};
const cat = async (who, key) =>
  (await who("/api/notifications/summary")).body.categories.find((c) => c.key === key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const needOn = (who, partnerId, extra = {}) =>
  who("/api/support-needs", {
    method: "POST",
    body: { partnerId, description: "a need", requestedAmount: 500, requestDate: dayStr(), ...extra },
  });
const prayerOn = (who, partnerId, extra = {}) =>
  who("/api/prayer-requests", {
    method: "POST",
    body: { partnerId, category: "situational", requestText: "a prayer", dateReceived: dayStr(-1), ...extra },
  });
const decide = (needId, extra = {}) =>
  admin(`/api/support-needs/${needId}`, {
    method: "PUT",
    body: { approvedAmount: 300, approvedDate: dayStr(), decisionNote: "Funded in part", ...extra },
  });
const logContact = (who, partnerId, extra = {}) =>
  who("/api/contact-log", {
    method: "POST",
    body: { partnerId, contactType: "call", direction: "outbound", contactDate: dayStr(), ...extra },
  });

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  // trips: the trip-leader fixture needs a real trip, and a fresh DB has it off
  await setFeatures({
    careTeam: true,
    contactLog: true,
    prayerRequests: true,
    oneTimeNeeds: true,
    trips: true,
  });
  partnerA = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} updA` },
    })
  ).body;
  partnerB = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} updB` },
    })
  ).body;

  member = await makeGuest("member");
  await prisma.careTeamMember.create({ data: { partnerId: partnerA.id, userId: member.user.id } });
  tripLeader = await makeGuest("tripleader");
  const trip = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerA.id, status: "planning" },
  });
  await prisma.tripAccess.create({ data: { userId: tripLeader.user.id, tripId: trip.body.id } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("care team: new needs and prayers reach the team", () => {
  test("a care team guest is told about new needs on their own partner only, and can clear it", async () => {
    const m = await member.login();
    assert.equal((await cat(m, "newOneTimeNeeds")).count, 0);

    await needOn(admin, partnerA.id);
    await needOn(admin, partnerB.id); // not theirs
    const c = await cat(m, "newOneTimeNeeds");
    assert.equal(c.count, 1, "only the partner they look after");
    assert.equal(c.isNew, true);

    assert.equal(
      (await m("/api/notifications/seen", { method: "POST", body: { category: "newOneTimeNeeds" } })).status,
      204
    );
    assert.equal((await cat(m, "newOneTimeNeeds")).count, 0, "seen clears it");
    await sleep(25);
    await needOn(admin, partnerA.id);
    assert.equal((await cat(m, "newOneTimeNeeds")).count, 1, "and the next one is new again");
  });

  test("the same for prayer requests", async () => {
    const m = await member.login();
    const before = (await cat(m, "newPrayerRequests")).count;
    await prayerOn(admin, partnerA.id);
    await prayerOn(admin, partnerB.id);
    assert.equal((await cat(m, "newPrayerRequests")).count, before + 1);
  });

  test("a trip leader (no seat) is told nothing about needs or prayers", async () => {
    const t = await tripLeader.login();
    assert.equal((await cat(t, "newOneTimeNeeds")).count, 0);
    assert.equal((await cat(t, "newPrayerRequests")).count, 0);
    assert.equal((await cat(t, "updatesToPassOn")).count, 0);
  });
});

describe("care team: updates to pass on", () => {
  test("a decided need comes back to the team, and only an outbound 'need' contact clears it", async () => {
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} updNeed` },
      })
    ).body;
    const who = await makeGuest("needwho");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const g = await who.login();
    assert.equal((await cat(g, "updatesToPassOn")).count, 0);

    const need = (await needOn(admin, partner.id)).body;
    assert.equal((await cat(g, "updatesToPassOn")).count, 0, "an undecided need isn't an update yet");
    assert.equal((await decide(need.id)).status, 200);

    const c = await cat(g, "updatesToPassOn");
    assert.equal(c.count, 1);
    assert.equal(c.linkTo, `/admin/partners/${partner.id}`);

    // hearing from them (inbound), or a different topic, doesn't count as passing it on
    await logContact(g, partner.id, { direction: "inbound", topics: ["need"] });
    await logContact(g, partner.id, { topics: ["checkin"] });
    assert.equal((await cat(g, "updatesToPassOn")).count, 1);

    assert.equal((await logContact(g, partner.id, { topics: ["need"] })).status, 201);
    assert.equal((await cat(g, "updatesToPassOn")).count, 0, "relayed");
  });

  test("an old decision is not an update any more", async () => {
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} updOld` },
      })
    ).body;
    const who = await makeGuest("oldwho");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const need = (await needOn(admin, partner.id)).body;
    await decide(need.id, { approvedDate: dayStr(-60) });
    assert.equal((await cat(await who.login(), "updatesToPassOn")).count, 0);
  });

  test("an answered prayer asks for a thank-you; an outbound encouragement clears it", async () => {
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} updPrayer` },
      })
    ).body;
    const who = await makeGuest("prayerwho");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const g = await who.login();
    const prayer = (await prayerOn(admin, partner.id)).body;
    assert.equal((await cat(g, "updatesToPassOn")).count, 0, "an open prayer isn't an update");

    const answered = await admin(`/api/prayer-requests/${prayer.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: dayStr(), answeredNote: "She got the visa" },
    });
    assert.equal(answered.status, 200);
    assert.equal((await cat(g, "updatesToPassOn")).count, 1);

    await logContact(g, partner.id, { direction: "inbound", topics: ["encouragement"] });
    assert.equal((await cat(g, "updatesToPassOn")).count, 1, "inbound doesn't count");
    await logContact(g, partner.id, { contactType: "card", topics: ["encouragement"] });
    assert.equal((await cat(g, "updatesToPassOn")).count, 0, "the thank-you went out");
  });

  test("counts nothing while the contact log or care teams are off", async () => {
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} updGate` },
      })
    ).body;
    const who = await makeGuest("gatewho");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: who.user.id } });
    const g = await who.login();
    await decide((await needOn(admin, partner.id)).body.id);
    assert.equal((await cat(g, "updatesToPassOn")).count, 1);
    await setFeatures({ contactLog: false });
    try {
      assert.equal((await cat(g, "updatesToPassOn")).count, 0, "nothing to clear it with");
    } finally {
      await setFeatures({ contactLog: true });
    }
  });
});

describe("care team: marking a prayer answered counts as a contact", () => {
  test("a member's answered entry is auto-logged (inbound), a staff one is not", async () => {
    const m = await member.login();
    const prayer = (await prayerOn(admin, partnerA.id, { requestText: "member will answer" })).body;
    const res = await m(`/api/prayer-requests/${prayer.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: dayStr(), answeredNote: "Good news" },
    });
    assert.equal(res.status, 200);
    const auto = await prisma.contactLog.findFirst({ where: { prayerRequestId: prayer.id } });
    assert.ok(auto, "the contact was logged");
    assert.equal(auto.direction, "inbound");
    assert.deepEqual(auto.topics, ["prayer"]);
    assert.equal(auto.notes, "Prayer request answered.");
    assert.equal(auto.contactedById, member.user.id);

    const staffPrayer = (await prayerOn(admin, partnerA.id, { requestText: "staff will answer" })).body;
    await admin(`/api/prayer-requests/${staffPrayer.id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: dayStr() },
    });
    assert.equal(await prisma.contactLog.count({ where: { prayerRequestId: staffPrayer.id } }), 0);
  });

  test("re-saving an already answered request doesn't log a second contact", async () => {
    const m = await member.login();
    const prayer = (await prayerOn(admin, partnerA.id, { requestText: "answer twice" })).body;
    const body = { status: "answered", dateAnswered: dayStr(), answeredNote: "first" };
    await m(`/api/prayer-requests/${prayer.id}`, { method: "PUT", body });
    await m(`/api/prayer-requests/${prayer.id}`, {
      method: "PUT",
      body: { ...body, answeredNote: "typo fixed" },
    });
    assert.equal(await prisma.contactLog.count({ where: { prayerRequestId: prayer.id } }), 1);
  });
});
