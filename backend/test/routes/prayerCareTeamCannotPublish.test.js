// A care team member who isn't staff (a limited guest, or a viewer who can write only because they sit on the
// partner's care team) cannot put a prayer request on the public profile or the printed Sunday sheet: those
// two flags are read with no review check, so only an admin or editor may set them. Admins and editors are
// unchanged.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { eligiblePartners } = require("../../src/utils/prayerSheet");
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
let partner;
let originalFeatures;
const madeUsers = [];

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

async function makeMember(tag, role) {
  const email = `route-test-nopublish-${tag}@example.test`;
  const password = "RouteTestNoPublish123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role, active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role,
      authProvider: "local",
      active: true,
    },
  });
  madeUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

const body = (extra = {}) => ({
  partnerId: partner.id,
  category: "strategic",
  requestText: `${FIXTURE_TAG} pray for the school`,
  dateReceived: "2026-11-20",
  ...extra,
});

// The Sunday sheet's own selection: what prayerSheet.js would print for this partner.
async function onTheSheet(text) {
  const all = await eligiblePartners({ perPartner: 50 });
  return all.some((p) => p.id === partner.id && p.requests.some((r) => r.text === text));
}

before(async () => {
  await ensureTestUsers();
  [admin, editor] = await Promise.all([client("admin"), client("editor")]);
  await removeFixturePartners();
  originalFeatures =
    (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures ?? {};
  // A channel must be on for any update to be queued (and so held for review) at all.
  await setFeatures({ careTeam: true, prayerRequests: true, outboundEmail: true });
  partner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} nopublish`, isPublic: true },
    })
  ).body;
});

after(async () => {
  await prisma.dispatchRecord.deleteMany({ where: { partnerId: partner.id } });
  await prisma.prayerRequest.deleteMany({ where: { partnerId: partner.id } });
  await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await stopServer();
});

for (const role of ["guest", "viewer"]) {
  describe(`a care team ${role}`, () => {
    let me;
    before(async () => {
      const m = await makeMember(role, role);
      const res = await admin(`/api/care-team/${partner.id}`, {
        method: "PUT",
        body: { leadUserId: null, memberUserIds: [m.user.id] },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      me = await m.login();
    });

    test("cannot set either flag when creating a request", async () => {
      const text = `${FIXTURE_TAG} ${role} create`;
      const res = await me("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: true }),
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.isPublic, false);
      assert.equal(res.body.includeInBooklet, false);
      const stored = await prisma.prayerRequest.findUnique({ where: { id: res.body.id } });
      assert.equal(stored.isPublic, false);
      assert.equal(stored.includeInBooklet, false);
      assert.equal(await onTheSheet(text), false, "not on the Sunday sheet");
    });

    test("cannot set either flag when updating their own request", async () => {
      const text = `${FIXTURE_TAG} ${role} update`;
      const made = await me("/api/prayer-requests", { method: "POST", body: body({ requestText: text }) });
      const res = await me(`/api/prayer-requests/${made.body.id}`, {
        method: "PUT",
        body: { isPublic: true, includeInBooklet: true },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = await prisma.prayerRequest.findUnique({ where: { id: made.body.id } });
      assert.equal(stored.isPublic, false);
      assert.equal(stored.includeInBooklet, false);
      assert.equal(await onTheSheet(text), false);
    });

    test("editing a request staff made public leaves staff's choice alone, and cannot widen it", async () => {
      const text = `${FIXTURE_TAG} ${role} staffpublic`;
      const staffMade = await admin("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: false }),
      });
      assert.equal(staffMade.body.isPublic, true);
      const res = await me(`/api/prayer-requests/${staffMade.body.id}`, {
        method: "PUT",
        body: { includeInBooklet: true, notes: "a note" },
      });
      assert.equal(res.status, 200);
      const stored = await prisma.prayerRequest.findUnique({ where: { id: staffMade.body.id } });
      assert.equal(stored.isPublic, true, "staff's choice kept");
      assert.equal(stored.includeInBooklet, false, "the booklet flag was not widened");
      assert.equal(stored.notes, "a note", "their other edits still apply");
    });

    test("editing what is printed on a request staff made public takes it off until staff review it", async () => {
      const text = `${FIXTURE_TAG} ${role} reworded`;
      const staffMade = await admin("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: true }),
      });
      assert.equal(await onTheSheet(text), true, "staff's public request is on the sheet");
      const res = await me(`/api/prayer-requests/${staffMade.body.id}`, {
        method: "PUT",
        body: { requestText: `${text} (changed by a care team member)` },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = await prisma.prayerRequest.findUnique({ where: { id: staffMade.body.id } });
      assert.equal(stored.isPublic, false);
      assert.equal(stored.includeInBooklet, false);
      assert.equal(await onTheSheet(stored.requestText), false, "the reworded text is not on the sheet");
    });

    test("an answer note or status change on a public request is held back the same way", async () => {
      const text = `${FIXTURE_TAG} ${role} answered`;
      const staffMade = await admin("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: true }),
      });
      const res = await me(`/api/prayer-requests/${staffMade.body.id}`, {
        method: "PUT",
        body: { status: "answered", dateAnswered: "2026-11-25", answeredNote: "unreviewed note" },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = await prisma.prayerRequest.findUnique({ where: { id: staffMade.body.id } });
      assert.equal(stored.isPublic, false);
      assert.equal(stored.includeInBooklet, false);
    });

    test("a staff edit to a public request leaves it public", async () => {
      const text = `${FIXTURE_TAG} ${role} staffedit`;
      const staffMade = await admin("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: true }),
      });
      await admin(`/api/prayer-requests/${staffMade.body.id}`, {
        method: "PUT",
        body: { requestText: `${text} v2` },
      });
      const stored = await prisma.prayerRequest.findUnique({ where: { id: staffMade.body.id } });
      assert.equal(stored.isPublic, true);
      assert.equal(stored.includeInBooklet, true);
    });

    test("their request is still held for staff review", async () => {
      const made = await me("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: `${FIXTURE_TAG} ${role} held`, isPublic: true }),
      });
      const row = await prisma.dispatchRecord.findFirst({
        where: { partnerId: partner.id, payload: { path: ["prayerRequestId"], equals: made.body.id } },
      });
      assert.equal(row?.reviewRequired, true);
    });
  });
}

describe("admins and editors are unchanged", () => {
  for (const [name, who] of [
    ["an admin", () => admin],
    ["an editor", () => editor],
  ]) {
    test(`${name} can still make a request public and put it in the booklet and on the sheet`, async () => {
      const text = `${FIXTURE_TAG} ${name} public`;
      const res = await who()("/api/prayer-requests", {
        method: "POST",
        body: body({ requestText: text, isPublic: true, includeInBooklet: true }),
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.isPublic, true);
      assert.equal(res.body.includeInBooklet, true);
      assert.equal(await onTheSheet(text), true);
      const upd = await who()(`/api/prayer-requests/${res.body.id}`, {
        method: "PUT",
        body: { includeInBooklet: false },
      });
      assert.equal(upd.body.includeInBooklet, false);
    });
  }
});
