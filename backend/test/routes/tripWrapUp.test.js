// The Wrap up trip wizard's endpoint and its two bell items. Covers what a wrap-up saves
// (status, actual dates, the debrief, the album link), who may run it (admin, editor, a trip
// leader for their own trip only), the optional contact for the partner (and when it is NOT
// made), that a second run keeps the first wrap-up time, and the "ready to wrap up" and
// "wrapped up" bell items.
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
let editor;
let originalFeatures;
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
  const email = `route-test-wrapup-${tag}@example.test`;
  const password = "RouteTestWrap123!";
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

const day = (offset) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
};
const iso = (d) => d.toISOString().slice(0, 10);

const newPartner = async (tag) =>
  (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} wrapup ${tag}` },
    })
  ).body;
// A finished trip's dates, in the past, still planned (not yet wrapped up).
const newTrip = async (partnerId, tag, extra = {}) =>
  (
    await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId,
        name: `${FIXTURE_TAG} ${tag}`,
        status: "closed",
        startDate: iso(day(-20)),
        endDate: iso(day(-10)),
        ...extra,
      },
    })
  ).body;
const wrapUp = (who, tripId, body) => who(`/api/trips/${tripId}/wrap-up`, { method: "POST", body });
const bell = async (who, key) =>
  (await who("/api/notifications/summary")).body.categories.find((c) => c.key === key);

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ trips: true, careTeam: true, contactLog: true });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await stopServer();
});

describe("POST /api/trips/:id/wrap-up", () => {
  test("completes the trip and saves the dates, the debrief and the album link", async () => {
    const partner = await newPartner("save");
    const trip = await newTrip(partner.id, "save");
    const res = await wrapUp(admin, trip.id, {
      startDate: iso(day(-21)),
      endDate: iso(day(-9)),
      debrief: {
        whatWeDid: "Built the school roof",
        wentWell: "  The team gelled  ",
        wasHard: "",
        partnerNeeds: "More cement",
      },
      albumProvider: "other",
      albumUrl: "https://photos.example.com/album/1",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const saved = await prisma.trip.findUnique({ where: { id: trip.id } });
    assert.equal(saved.status, "completed");
    assert.ok(saved.wrappedUpAt, "the wrap-up time is recorded");
    assert.equal(iso(saved.startDate), iso(day(-21)));
    assert.equal(iso(saved.endDate), iso(day(-9)));
    assert.equal(saved.debriefWhatWeDid, "Built the school roof");
    assert.equal(saved.debriefWentWell, "The team gelled", "trimmed");
    assert.equal(saved.debriefWasHard, null, "an empty answer is stored as none");
    assert.equal(saved.debriefPartnerNeeds, "More cement");
    assert.equal(saved.albumUrl, "https://photos.example.com/album/1");
    assert.equal(res.body.trip.id, trip.id);
  });

  test("a second run edits the debrief and keeps the first wrap-up time", async () => {
    const partner = await newPartner("rerun");
    const trip = await newTrip(partner.id, "rerun");
    await wrapUp(admin, trip.id, { debrief: { whatWeDid: "First" } });
    const first = await prisma.trip.findUnique({ where: { id: trip.id } });
    await new Promise((r) => setTimeout(r, 20));
    await wrapUp(editor, trip.id, { debrief: { wentWell: "Added later" } });
    const second = await prisma.trip.findUnique({ where: { id: trip.id } });
    assert.equal(second.wrappedUpAt.getTime(), first.wrappedUpAt.getTime());
    assert.equal(second.debriefWhatWeDid, "First", "a prompt not sent is left alone");
    assert.equal(second.debriefWentWell, "Added later");
  });

  test("rejects an end before the start, a bad album link, a missing trip, and a viewer", async () => {
    const partner = await newPartner("invalid");
    const trip = await newTrip(partner.id, "invalid");
    assert.equal(
      (await wrapUp(admin, trip.id, { startDate: iso(day(-5)), endDate: iso(day(-8)) })).status,
      400
    );
    assert.equal(
      (await wrapUp(admin, trip.id, { endDate: iso(day(-30)) })).status,
      400,
      "before the stored start"
    );
    assert.equal(
      (await wrapUp(admin, trip.id, { albumProvider: "google_photos", albumUrl: "https://example.com/x" }))
        .status,
      400
    );
    assert.equal((await wrapUp(admin, "no-such-trip", {})).status, 404);
    const viewer = await client("viewer");
    assert.equal((await wrapUp(viewer, trip.id, {})).status, 403);
    assert.notEqual((await prisma.trip.findUnique({ where: { id: trip.id } })).status, "completed");
  });
});

describe("who may wrap a trip up", () => {
  test("a trip leader can for their own trip, and not for another", async () => {
    const partner = await newPartner("leader");
    const own = await newTrip(partner.id, "leader-own");
    const other = await newTrip(partner.id, "leader-other");
    const leader = await makeGuest("leader");
    await prisma.tripAccess.create({ data: { userId: leader.user.id, tripId: own.id } });
    const asLeader = await leader.login();
    assert.equal((await wrapUp(asLeader, own.id, { debrief: { whatWeDid: "Our trip" } })).status, 200);
    assert.equal((await wrapUp(asLeader, other.id, {})).status, 403);
    assert.equal((await prisma.trip.findUnique({ where: { id: own.id } })).status, "completed");
    assert.notEqual((await prisma.trip.findUnique({ where: { id: other.id } })).status, "completed");
  });
});

describe("the follow-up contact for the partner", () => {
  test("is logged for staff when asked, as a visit we made with the trip topic and a follow-up date", async () => {
    const partner = await newPartner("contact");
    const trip = await newTrip(partner.id, "contact");
    const res = await wrapUp(admin, trip.id, { followUp: { logContact: true, followUpDate: iso(day(30)) } });
    assert.equal(res.status, 200);
    assert.equal(res.body.contactLogged, true);
    const logs = await prisma.contactLog.findMany({ where: { partnerId: partner.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].contactType, "visit");
    assert.equal(logs[0].direction, "outbound");
    assert.deepEqual(logs[0].topics, ["trip"]);
    assert.equal(iso(logs[0].followUpDate), iso(day(30)));
    assert.match(logs[0].notes, /Trip wrapped up/);
  });

  test("is not logged unless asked, when the contact log is off, or for a trip leader (no contact log reach)", async () => {
    const partner = await newPartner("nocontact");
    const t1 = await newTrip(partner.id, "nocontact-1");
    const t2 = await newTrip(partner.id, "nocontact-2");
    const t3 = await newTrip(partner.id, "nocontact-3");
    assert.equal((await wrapUp(admin, t1.id, {})).body.contactLogged, false, "not asked");
    await setFeatures({ contactLog: false });
    try {
      assert.equal(
        (await wrapUp(admin, t2.id, { followUp: { logContact: true } })).body.contactLogged,
        false
      );
    } finally {
      await setFeatures({ contactLog: true });
    }
    const leader = await makeGuest("nocontact-leader");
    await prisma.tripAccess.create({ data: { userId: leader.user.id, tripId: t3.id } });
    const res = await wrapUp(await leader.login(), t3.id, { followUp: { logContact: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.contactLogged, false);
    assert.equal(await prisma.contactLog.count({ where: { partnerId: partner.id } }), 0);
  });
});

describe("the bell", () => {
  test("'Trips ready to wrap up' counts a finished trip until it is wrapped up, and a leader sees only their own", async () => {
    const partner = await newPartner("bell-ready");
    const trip = await newTrip(partner.id, "bell-ready");
    const future = await newTrip(partner.id, "bell-future", {
      startDate: iso(day(5)),
      endDate: iso(day(12)),
    });
    const leader = await makeGuest("bell-leader");
    await prisma.tripAccess.create({ data: { userId: leader.user.id, tripId: trip.id } });
    const asLeader = await leader.login();

    const staff = await bell(admin, "tripsReadyToWrapUp");
    assert.ok(staff.count >= 1, "staff see it");
    const mine = await bell(asLeader, "tripsReadyToWrapUp");
    assert.equal(mine.count, 1, "the leader's own trip only");
    assert.equal(mine.linkTo, `/admin/trips/${trip.id}`, "linked straight to it");

    await wrapUp(admin, trip.id, {});
    assert.equal((await bell(asLeader, "tripsReadyToWrapUp")).count, 0);
    assert.notEqual(future.id, trip.id); // a trip that hasn't ended was never counted
  });

  test("'Trips wrapped up' tells the partner's care team, and nobody else", async () => {
    const partner = await newPartner("bell-wrapped");
    const trip = await newTrip(partner.id, "bell-wrapped");
    const member = await makeGuest("bell-member");
    const outsider = await makeGuest("bell-outsider");
    const elsewhere = await newPartner("bell-elsewhere");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: partner.id, userId: member.user.id },
        { partnerId: elsewhere.id, userId: outsider.user.id },
      ],
    });
    const asMember = await member.login();
    const asOutsider = await outsider.login();
    assert.equal((await bell(asMember, "tripsWrappedUp")).count, 0, "nothing before the wrap-up");
    await wrapUp(admin, trip.id, {});
    const seen = await bell(asMember, "tripsWrappedUp");
    assert.equal(seen.count, 1);
    assert.equal(seen.linkTo, `/admin/trips/${trip.id}`);
    assert.equal((await bell(asOutsider, "tripsWrappedUp")).count, 0, "not their partner");
  });
});
