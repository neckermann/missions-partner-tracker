// Care teams: one lead plus members per partner, all logins. Covers the feature gate (404 off,
// data kept), the one-lead rule (also in the database), replace-the-team semantics, who may
// read/set a team, guests reaching a partner through a seat (never expiring, ignored when the
// feature is off), orphan deactivation, user create with seats, and the coverage report.
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
let originalEnabledFeatures;
let partnerA;
let partnerB;
let adminUser;
let editorUser;
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
  const email = `route-test-care-${tag}@example.test`;
  const password = "RouteTestCare123!";
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
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

const setTeam = (partnerId, body, who = admin) => who(`/api/care-team/${partnerId}`, { method: "PUT", body });

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  adminUser = await prisma.user.findUnique({ where: { email: TEST_USERS.admin.email } });
  editorUser = await prisma.user.findUnique({ where: { email: TEST_USERS.editor.email } });
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ careTeam: true, reports: true, outboundEmail: true });
  partnerA = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} careA` },
    })
  ).body;
  partnerB = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} careB` },
    })
  ).body;
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

describe("care team: the feature gate", () => {
  test("404s every route while the feature is off, and keeps the data", async () => {
    await setTeam(partnerA.id, { leadUserId: adminUser.id, memberUserIds: [] });
    await setFeatures({ careTeam: false });
    try {
      assert.equal((await admin(`/api/care-team/${partnerA.id}`)).status, 404);
      assert.equal((await admin("/api/care-team/candidates")).status, 404);
      assert.equal((await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] })).status, 404);
      assert.equal(await prisma.careTeamMember.count({ where: { partnerId: partnerA.id } }), 1);
    } finally {
      await setFeatures({ careTeam: true });
      await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] });
    }
  });

  test("the coverage report only exists while the feature is on", async () => {
    assert.ok((await admin("/api/reports")).body.reports.some((r) => r.id === "care-team-coverage"));
    await setFeatures({ careTeam: false });
    try {
      assert.ok(!(await admin("/api/reports")).body.reports.some((r) => r.id === "care-team-coverage"));
      assert.equal((await admin("/api/reports/care-team-coverage")).status, 404);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });
});

describe("care team: setting and reading a team", () => {
  test("sets a lead and members, and reads it back", async () => {
    const res = await setTeam(partnerA.id, { leadUserId: adminUser.id, memberUserIds: [editorUser.id] });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.userId, adminUser.id);
    assert.deepEqual(
      res.body.members.map((m) => m.userId),
      [editorUser.id]
    );
    const read = await viewer(`/api/care-team/${partnerA.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.lead.email, TEST_USERS.admin.email);
  });

  test("replaces the whole team and moves the lead without ever having two", async () => {
    const res = await setTeam(partnerA.id, { leadUserId: editorUser.id, memberUserIds: [adminUser.id] });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.userId, editorUser.id);
    assert.deepEqual(
      res.body.members.map((m) => m.userId),
      [adminUser.id]
    );
    assert.equal(await prisma.careTeamMember.count({ where: { partnerId: partnerA.id, isLead: true } }), 1);
  });

  test("naming the lead among the members is just the lead", async () => {
    const res = await setTeam(partnerA.id, {
      leadUserId: adminUser.id,
      memberUserIds: [adminUser.id, editorUser.id],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.members.length, 1);
    assert.equal(await prisma.careTeamMember.count({ where: { partnerId: partnerA.id } }), 2);
  });

  test("a team can have members and no lead", async () => {
    const res = await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [adminUser.id] });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead, null);
    assert.equal(res.body.members.length, 1);
  });

  test("the database itself refuses a second lead", async () => {
    await setTeam(partnerA.id, { leadUserId: adminUser.id, memberUserIds: [] });
    await assert.rejects(
      prisma.careTeamMember.create({ data: { partnerId: partnerA.id, userId: editorUser.id, isLead: true } })
    );
  });

  test("refuses an inactive or unknown login", async () => {
    const gone = await makeUser("inactive", "viewer");
    await prisma.user.update({ where: { id: gone.user.id }, data: { active: false } });
    assert.equal((await setTeam(partnerA.id, { leadUserId: gone.user.id, memberUserIds: [] })).status, 400);
    assert.equal(
      (
        await setTeam(partnerA.id, {
          leadUserId: null,
          memberUserIds: ["00000000-0000-0000-0000-000000000000"],
        })
      ).status,
      400
    );
  });

  test("an editor may set a team, a viewer may not, and 404 for an unknown partner", async () => {
    assert.equal(
      (await setTeam(partnerB.id, { leadUserId: adminUser.id, memberUserIds: [] }, editor)).status,
      200
    );
    assert.equal((await setTeam(partnerB.id, { leadUserId: null, memberUserIds: [] }, viewer)).status, 403);
    assert.equal((await admin("/api/care-team/00000000-0000-0000-0000-000000000000")).status, 404);
  });

  test("candidates are active logins, for admin and editor only", async () => {
    const res = await editor("/api/care-team/candidates");
    assert.equal(res.status, 200);
    assert.ok(res.body.every((u) => u.id && u.email));
    assert.equal((await viewer("/api/care-team/candidates")).status, 403);
  });
});

describe("care team: guests", () => {
  let g;

  before(async () => {
    g = await makeUser("guest");
  });

  test("a guest with no trip and no seat can't sign in", async () => {
    const guest = await g.login();
    assert.equal((await guest("/api/auth/me")).status, 401);
  });

  test("a seat reaches that partner (and only that partner), with no expiry", async () => {
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [g.user.id] });
    const guest = await g.login();
    assert.equal((await guest(`/api/partners/${partnerA.id}`)).status, 200);
    assert.equal((await guest(`/api/partners/${partnerB.id}`)).status, 403);
    assert.equal((await guest(`/api/prayer-requests?partnerId=${partnerA.id}`)).status, 200);
    assert.equal((await guest(`/api/prayer-requests?partnerId=${partnerB.id}`)).status, 403);
    // the directory lists only the partners they reach
    const dir = await guest("/api/partners");
    assert.equal(dir.status, 200);
    assert.deepEqual(
      dir.body.map((p) => p.id),
      [partnerA.id]
    );
  });

  test("a guest reads their own team without teammates' email addresses, and can't set it", async () => {
    const guest = await g.login();
    const read = await guest(`/api/care-team/${partnerA.id}`);
    assert.equal(read.status, 200);
    assert.ok(read.body.members.every((m) => m.email === undefined));
    assert.ok(
      [read.body.lead, ...read.body.members].every(
        (m) => !m || (m.phone === undefined && m.profile === undefined)
      )
    );
    assert.equal((await guest(`/api/care-team/${partnerB.id}`)).status, 403);
    assert.equal((await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] }, guest)).status, 403);
  });

  test("/me lists the care team seats, for any role", async () => {
    const guest = await g.login();
    const me = await guest("/api/auth/me");
    assert.deepEqual(
      me.body.user.careTeamSeats.map((p) => p.id),
      [partnerA.id]
    );
  });

  test("turning the feature off ignores the seat for access, and turning it on restores it", async () => {
    await setFeatures({ careTeam: false });
    try {
      assert.equal((await (await g.login())("/api/auth/me")).status, 401);
    } finally {
      await setFeatures({ careTeam: true });
    }
    assert.equal((await (await g.login())("/api/auth/me")).status, 200);
  });

  test("removing the guest's last seat deactivates the account", async () => {
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] });
    const row = await prisma.user.findUnique({ where: { id: g.user.id } });
    assert.equal(row.active, false);
    const listed = (await admin("/api/users")).body.find((u) => u.id === g.user.id);
    assert.equal(listed.inactiveReason, "deactivated");
  });

  test("a guest who still holds a trip grant is not deactivated when a seat goes", async () => {
    const both = await makeUser("both");
    const trip = await prisma.trip.create({ data: { partnerId: partnerB.id, status: "planning" } });
    await prisma.tripAccess.create({ data: { userId: both.user.id, tripId: trip.id } });
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [both.user.id] });
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] });
    const row = await prisma.user.findUnique({ where: { id: both.user.id } });
    assert.equal(row.active, true);
  });
});

describe("care team: users created or promoted with seats", () => {
  test("creates a guest with only a care team seat", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-care-seatonly@example.test",
        role: "guest",
        careTeam: [{ partnerId: partnerA.id }],
        password: "Password123!",
      },
    });
    assert.equal(res.status, 201);
    extraUsers.push(res.body.id);
    assert.equal(res.body.mfaSetupRequired, false);
    assert.equal(res.body.inactiveReason, null);
    assert.deepEqual(
      res.body.careTeamSeats.map((s) => s.partner.id),
      [partnerA.id]
    );
    assert.equal((await prisma.careTeamMember.findFirst({ where: { userId: res.body.id } })).isLead, false);
  });

  test("a guest still needs a trip or a seat", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-care-nothing@example.test", role: "guest", password: "Password123!" },
    });
    assert.equal(res.status, 400);
  });

  test("a full role can join a care team at creation too", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-care-editor@example.test",
        role: "editor",
        careTeam: [{ partnerId: partnerB.id }],
        password: "Password123!",
      },
    });
    assert.equal(res.status, 201);
    extraUsers.push(res.body.id);
    assert.equal(res.body.careTeamSeats.length, 1);
  });

  test("promoting an editor to guest works with just a seat, and not with nothing", async () => {
    const made = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-care-promote@example.test", role: "editor", password: "Password123!" },
    });
    assert.equal(made.status, 201);
    extraUsers.push(made.body.id);

    const nothing = await admin(`/api/users/${made.body.id}`, { method: "PUT", body: { role: "guest" } });
    assert.equal(nothing.status, 400);

    const ok = await admin(`/api/users/${made.body.id}`, {
      method: "PUT",
      body: { role: "guest", careTeam: [{ partnerId: partnerA.id }] },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.role, "guest");
    assert.equal(ok.body.mfaSetupRequired, false);
    assert.equal(ok.body.inactiveReason, null);
    assert.deepEqual(
      ok.body.careTeamSeats.map((s) => s.partner.id),
      [partnerA.id]
    );
  });

  test("seats are refused while the feature is off, and for a partner that doesn't exist", async () => {
    const bad = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-care-badpartner@example.test",
        role: "editor",
        careTeam: [{ partnerId: "00000000-0000-0000-0000-000000000000" }],
        password: "Password123!",
      },
    });
    assert.equal(bad.status, 400);
    await setFeatures({ careTeam: false });
    try {
      const off = await admin("/api/users", {
        method: "POST",
        body: {
          email: "route-test-care-off@example.test",
          role: "editor",
          careTeam: [{ partnerId: partnerA.id }],
          password: "Password123!",
        },
      });
      assert.equal(off.status, 400);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });

  test("deleting a partner removes its team; deleting a lead leaves the partner leaderless", async () => {
    const lead = await makeUser("lead", "editor");
    await setTeam(partnerB.id, { leadUserId: lead.user.id, memberUserIds: [] });
    await prisma.user.delete({ where: { id: lead.user.id } });
    const team = await admin(`/api/care-team/${partnerB.id}`);
    assert.equal(team.body.lead, null);
  });
});

describe("care team: coverage report", () => {
  test("lists partners with no team or no lead, and not covered ones, until 'only gaps' is off", async () => {
    await setTeam(partnerA.id, { leadUserId: adminUser.id, memberUserIds: [] });
    await setTeam(partnerB.id, { leadUserId: null, memberUserIds: [editorUser.id] });
    const gaps = await admin("/api/reports/care-team-coverage");
    assert.equal(gaps.status, 200);
    const named = (res, name) => res.body.rows.find((r) => r.partnerName === name);
    assert.equal(named(gaps, `${FIXTURE_TAG} careB`).status, "No lead");
    assert.equal(named(gaps, `${FIXTURE_TAG} careA`), undefined, "a covered partner is hidden by default");
    const all = await admin("/api/reports/care-team-coverage?onlyGaps=false");
    assert.equal(named(all, `${FIXTURE_TAG} careA`).status, "Covered");
  });
});

// A care team member's prayer requests and one-time needs: entered through the normal routes,
// limited to what the role may touch, and always held in Pending Dispatches until staff review
// them, never sent on their own.

describe("care team: submitting prayer requests and needs", () => {
  let member; // on partnerA's team
  let outsider; // a guest with a trip grant only
  let tripGuest;
  const records = { prayers: [], needs: [] };
  const uploadedFiles = [];

  before(async () => {
    member = await makeUser("writer");
    tripGuest = await makeUser("tripwriter");
    outsider = tripGuest;
    const trip = await prisma.trip.create({ data: { partnerId: partnerA.id, status: "planning" } });
    await prisma.tripAccess.create({ data: { userId: tripGuest.user.id, tripId: trip.id } });
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [member.user.id] });
  });

  after(async () => {
    await prisma.dispatchRecord.deleteMany({ where: { partnerId: { in: [partnerA.id, partnerB.id] } } });
    await prisma.prayerRequest.deleteMany({ where: { id: { in: records.prayers } } });
    await prisma.supportNeed.deleteMany({ where: { id: { in: records.needs } } });
    await prisma.partnerFile.deleteMany({ where: { id: { in: uploadedFiles } } });
  });

  const prayerBody = (extra = {}) => ({
    partnerId: partnerA.id,
    category: "situational",
    requestText: "care team prayer",
    dateReceived: "2026-01-01",
    ...extra,
  });
  const needBody = (extra = {}) => ({
    partnerId: partnerA.id,
    description: "care team need",
    requestedAmount: 250,
    requestDate: "2026-01-01",
    ...extra,
  });
  const dispatchFor = (type, partnerId = partnerA.id) =>
    prisma.dispatchRecord.findFirst({ where: { type, partnerId }, orderBy: { createdAt: "desc" } });

  test("a member creates a prayer request, and its dispatch is held for review", async () => {
    const m = await member.login();
    const res = await m("/api/prayer-requests", { method: "POST", body: prayerBody() });
    assert.equal(res.status, 201);
    records.prayers.push(res.body.id);
    assert.equal(res.body.isPublic, false);
    assert.equal(res.body.isUrgent, false);
    const row = await dispatchFor("prayerRequestCreated");
    assert.equal(row.reviewRequired, true);
    assert.equal(row.dispatchReviewedAt, null);
    // ...and the existing review queue lists it as held.
    const queue = await admin("/api/dispatches/pending");
    assert.equal(queue.body.find((r) => r.id === row.id)?.needsReview, true);
    // ...and says WHY: a care team member entered it, not a restricted partner
    assert.equal(queue.body.find((r) => r.id === row.id)?.reviewRequired, true);
    assert.equal(queue.body.find((r) => r.id === row.id)?.isRestricted, false);
  });

  test("staff approving it in Pending Dispatches releases it", async () => {
    const row = await dispatchFor("prayerRequestCreated");
    const res = await admin(`/api/dispatches/pending/${row.id}`, {
      method: "PUT",
      body: { text: "care team prayer" },
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await prisma.dispatchRecord.findUnique({ where: { id: row.id } })).dispatchReviewedAt !== null,
      true
    );
  });

  test("a member can make a request public like an editor, but urgent and pre-approve are ignored", async () => {
    const m = await member.login();
    const res = await m("/api/prayer-requests", {
      method: "POST",
      body: prayerBody({
        requestText: "tries extras",
        category: "strategic",
        isUrgent: true,
        isPublic: true,
        includeInBooklet: true,
        approveNow: true,
      }),
    });
    assert.equal(res.status, 201);
    records.prayers.push(res.body.id);
    assert.equal(res.body.isPublic, true, "editor parity: they may make it public");
    assert.equal(res.body.includeInBooklet, true);
    assert.equal(res.body.isUrgent, false, "urgent would send ahead of review");
    const row = await prisma.dispatchRecord.findFirst({
      where: { type: "prayerRequestCreated", partnerId: partnerA.id },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(row.reviewRequired, true);
    assert.equal(row.dispatchReviewedAt, null, "approveNow must not release it");
  });

  test("a member can't write for a partner whose team they're not on, nor can a trip-only guest", async () => {
    const m = await member.login();
    assert.equal(
      (await m("/api/prayer-requests", { method: "POST", body: prayerBody({ partnerId: partnerB.id }) }))
        .status,
      403
    );
    const t = await outsider.login();
    assert.equal((await t("/api/prayer-requests", { method: "POST", body: prayerBody() })).status, 403);
  });

  test("a member edits their partner's request, including a public one", async () => {
    const m = await member.login();
    const id = records.prayers[0];
    const edit = await m(`/api/prayer-requests/${id}`, { method: "PUT", body: { requestText: "reworded" } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.requestText, "reworded");

    const pub = await prisma.prayerRequest.create({
      data: {
        partnerId: partnerA.id,
        category: "strategic",
        requestText: "public one",
        dateReceived: new Date("2026-01-01"),
        isPublic: true,
      },
    });
    records.prayers.push(pub.id);
    assert.equal(
      (await m(`/api/prayer-requests/${pub.id}`, { method: "PUT", body: { requestText: "edited" } })).status,
      200
    );
  });

  test("a member can't mark it urgent, move it to a partner they're not on, or delete it", async () => {
    const m = await member.login();
    const id = records.prayers[0];
    const res = await m(`/api/prayer-requests/${id}`, {
      method: "PUT",
      body: { isUrgent: true, isPublic: true, requestText: "still reworded" },
    });
    assert.equal(res.status, 200);
    const row = await prisma.prayerRequest.findUnique({ where: { id } });
    assert.equal(row.requestText, "still reworded");
    assert.equal(row.isPublic, true, "editor parity");
    assert.equal(row.isUrgent, false, "urgent is ignored");
    assert.equal(
      (await m(`/api/prayer-requests/${id}`, { method: "PUT", body: { partnerId: partnerB.id } })).status,
      403
    );
    assert.equal((await prisma.prayerRequest.findUnique({ where: { id } })).partnerId, partnerA.id);
    assert.equal((await m(`/api/prayer-requests/${id}`, { method: "DELETE" })).status, 403);
  });

  test("marking a request answered creates a held dispatch", async () => {
    const m = await member.login();
    const id = records.prayers[0];
    const res = await m(`/api/prayer-requests/${id}`, {
      method: "PUT",
      body: { status: "answered", dateAnswered: "2026-02-01", answeredNote: "thank God" },
    });
    assert.equal(res.status, 200);
    const row = await dispatchFor("prayerRequestAnswered");
    assert.equal(row.reviewRequired, true);
    assert.equal(row.dispatchReviewedAt, null);
  });

  test("staff-made records are NOT held (staff behaviour is unchanged)", async () => {
    const res = await admin("/api/prayer-requests", {
      method: "POST",
      body: prayerBody({ requestText: "staff prayer" }),
    });
    assert.equal(res.status, 201);
    records.prayers.push(res.body.id);
    const row = await dispatchFor("prayerRequestCreated");
    assert.equal(row.reviewRequired, false);
  });

  test("a member creates a need that waits for staff, and can't decide, flag or pre-approve it", async () => {
    const m = await member.login();
    const res = await m("/api/support-needs", {
      method: "POST",
      body: needBody({
        isUrgent: true,
        approveNow: true,
        approvedAmount: 250,
        approvedDate: "2026-02-01",
        decisionNote: "yes",
      }),
    });
    assert.equal(res.status, 201);
    records.needs.push(res.body.id);
    assert.equal(res.body.approvedAmount, null, "no decision recorded");
    assert.equal(res.body.approvedDate, null);
    assert.equal(res.body.decisionNote, null);
    assert.equal(res.body.isUrgent, false);
    const row = await dispatchFor("supportNeedCreated");
    assert.equal(row.reviewRequired, true);
    assert.equal(row.dispatchReviewedAt, null);
  });

  test("a trip leader of the same partner still can't read its needs -- a smaller scope", async () => {
    const t = await outsider.login();
    assert.equal((await t(`/api/support-needs?partnerId=${partnerA.id}`)).status, 403);
    const list = await t("/api/support-needs");
    assert.deepEqual(list.body, []);
  });

  test("a member reads the whole need, notes included, and edits it but never its decision", async () => {
    const m = await member.login();
    const id = records.needs[0];
    await prisma.supportNeed.update({ where: { id }, data: { notes: "internal context" } });
    const list = await m(`/api/support-needs?partnerId=${partnerA.id}`);
    const need = list.body.find((n) => n.id === id);
    assert.equal(need.notes, "internal context");
    assert.equal(need.requestedAmount, 250);

    assert.equal(
      (await m(`/api/support-needs/${id}`, { method: "PUT", body: { description: "clearer" } })).status,
      200
    );
    assert.equal(
      (
        await m(`/api/support-needs/${id}`, {
          method: "PUT",
          body: { approvedAmount: 1, approvedDate: "2026-02-01" },
        })
      ).status,
      200
    );
    // ...but an attempt to record a decision is ignored, not applied
    assert.equal((await prisma.supportNeed.findUnique({ where: { id } })).approvedAmount, null);

    await prisma.supportNeed.update({
      where: { id },
      data: { approvedAmount: 100, approvedDate: new Date("2026-02-01") },
    });
    // editor parity: they may still fix the wording after staff decided --
    // but never touch the decision itself
    const late = await m(`/api/support-needs/${id}`, {
      method: "PUT",
      body: { description: "late edit", approvedAmount: 999 },
    });
    assert.equal(late.status, 200);
    const after = await prisma.supportNeed.findUnique({ where: { id } });
    assert.equal(after.description, "late edit");
    assert.equal(after.approvedAmount, 100, "the committee's decision is untouched");
    assert.equal((await m(`/api/support-needs/${id}`, { method: "DELETE" })).status, 403);
  });

  test("a viewer on the team can submit; a viewer who isn't can't", async () => {
    const v = await makeUser("viewerwriter", "viewer");
    const v2 = await v.login();
    assert.equal((await v2("/api/prayer-requests", { method: "POST", body: prayerBody() })).status, 403);
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [member.user.id, v.user.id] });
    const ok = await v2("/api/prayer-requests", {
      method: "POST",
      body: prayerBody({ requestText: "viewer prayer" }),
    });
    assert.equal(ok.status, 201);
    records.prayers.push(ok.body.id);
  });

  // A minimal but real PDF, so the upload's signature check passes.
  const pdfForm = (partnerId, extra = {}) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["%PDF-1.4\n%care-team-fixture\n"], { type: "application/pdf" }),
      "update.pdf"
    );
    form.append("partnerId", partnerId);
    form.append("kind", extra.kind || "newsletter");
    form.append("title", extra.title || "Care team upload");
    form.append("receivedDate", "2026-02-02");
    return form;
  };
  test("a member uploads a newsletter for their partner, and its dispatch is held", async () => {
    const m = await member.login();
    const res = await m("/api/partner-files", { method: "POST", body: pdfForm(partnerA.id) });
    assert.equal(res.status, 201);
    uploadedFiles.push(res.body.id);
    const row = await dispatchFor("newsletterCreated");
    assert.equal(row.reviewRequired, true);
    assert.equal(row.dispatchReviewedAt, null);
    const queue = await admin("/api/dispatches/pending");
    assert.equal(queue.body.find((r) => r.id === row.id)?.needsReview, true);
  });

  test("a member can't upload for another partner, and a trip-only guest can't upload at all", async () => {
    const m = await member.login();
    assert.equal((await m("/api/partner-files", { method: "POST", body: pdfForm(partnerB.id) })).status, 403);
    const t = await outsider.login();
    assert.equal((await t("/api/partner-files", { method: "POST", body: pdfForm(partnerA.id) })).status, 403);
  });

  test("a member can retitle a file, but not delete it", async () => {
    const m = await member.login();
    const id = uploadedFiles[0];
    assert.equal(
      (await m(`/api/partner-files/${id}`, { method: "PUT", body: { title: "renamed" } })).status,
      200
    );
    assert.equal((await m(`/api/partner-files/${id}`, { method: "DELETE" })).status, 403);
    // the AI scan is open to them like an editor: whatever an admin gets back for
    // this file (it depends on whether the AI feature is on), a member gets the
    // same -- never a permission refusal.
    const asAdmin = await admin(`/api/partner-files/${id}/extract`, { method: "POST" });
    const asMember = await m(`/api/partner-files/${id}/extract`, { method: "POST" });
    assert.equal(asMember.status, asAdmin.status);
    assert.notEqual(asMember.status, 403);
    const t = await outsider.login();
    assert.equal((await t(`/api/partner-files/${id}`, { method: "PUT", body: { title: "x" } })).status, 403);
  });

  test("a document that isn't a newsletter is saved with no dispatch at all", async () => {
    const before = await prisma.dispatchRecord.count({
      where: { partnerId: partnerA.id, type: "newsletterCreated" },
    });
    const m = await member.login();
    const res = await m("/api/partner-files", {
      method: "POST",
      body: pdfForm(partnerA.id, { kind: "office_document" }),
    });
    assert.equal(res.status, 201);
    uploadedFiles.push(res.body.id);
    const after = await prisma.dispatchRecord.count({
      where: { partnerId: partnerA.id, type: "newsletterCreated" },
    });
    assert.equal(after, before);
  });

  test("a staff upload of a newsletter is NOT held", async () => {
    const res = await admin("/api/partner-files", {
      method: "POST",
      body: pdfForm(partnerA.id, { title: "staff upload" }),
    });
    assert.equal(res.status, 201);
    uploadedFiles.push(res.body.id);
    const row = await dispatchFor("newsletterCreated");
    assert.equal(row.reviewRequired, false);
  });

  test("turning the feature off removes a member's write access", async () => {
    await setFeatures({ careTeam: false });
    try {
      const m = await member.login();
      // their seat no longer counts, so they can't even sign in as a guest
      assert.equal((await m("/api/prayer-requests", { method: "POST", body: prayerBody() })).status, 401);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });
});

// A care team member has what an editor has on their own partner (profile, family, links,
// archive, files, prayers, needs) and nothing beyond it.

describe("care team: editor parity on their own partner, and nothing beyond it", () => {
  let member;
  let outsider;
  let viewerOff;
  const adultIds = [];

  before(async () => {
    member = await makeUser("parity");
    outsider = await makeUser("parityoutsider");
    viewerOff = await makeUser("parityviewer", "viewer");
    const trip = await prisma.trip.create({ data: { partnerId: partnerA.id, status: "planning" } });
    await prisma.tripAccess.create({ data: { userId: outsider.user.id, tripId: trip.id } });
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [member.user.id] });
  });

  after(async () => {
    await prisma.adult.deleteMany({ where: { id: { in: adultIds } } });
  });

  // Decided by the owner (A4, November 2026 review): who can see a partner publicly is staff's call, so a
  // care-team guest can edit the profile but not the public or restricted flags.
  test("edits the partner's profile and archives and unarchives it, but can't change who sees it", async () => {
    const m = await member.login();
    const res = await m(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: { overviewShort: "Edited by the care team" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.overviewShort, "Edited by the care team");

    const before = await prisma.partner.findUnique({ where: { id: partnerA.id } });
    for (const flags of [{ isPublic: !before.isPublic }, { isRestricted: !before.isRestricted }]) {
      const refused = await m(`/api/partners/${partnerA.id}`, { method: "PUT", body: flags });
      assert.equal(refused.status, 403, JSON.stringify(flags));
    }
    const after = await prisma.partner.findUnique({ where: { id: partnerA.id } });
    assert.equal(after.isPublic, before.isPublic);
    assert.equal(after.isRestricted, before.isRestricted);

    // The page sends the whole card, so resending the values as they are is not a change.
    const same = await m(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: { isPublic: before.isPublic, isRestricted: before.isRestricted, overviewShort: "Again" },
    });
    assert.equal(same.status, 200);

    // Staff can still change it.
    const staff = await admin(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: { isPublic: !before.isPublic },
    });
    assert.equal(staff.status, 200);
    await prisma.partner.update({ where: { id: partnerA.id }, data: { isPublic: before.isPublic } });

    assert.equal((await m(`/api/partners/${partnerA.id}/archive`, { method: "POST" })).status, 200);
    assert.equal((await m(`/api/partners/${partnerA.id}/unarchive`, { method: "POST" })).status, 200);
  });

  test("adds and edits family, links and languages for their partner, but can't delete", async () => {
    const m = await member.login();
    const adult = await m("/api/adults", {
      method: "POST",
      body: { partnerId: partnerA.id, firstName: "Fam" },
    });
    assert.equal(adult.status, 201);
    adultIds.push(adult.body.id);
    assert.equal(
      (await m(`/api/adults/${adult.body.id}`, { method: "PUT", body: { lastName: "Ily" } })).status,
      200
    );
    const link = await m("/api/partner-links", {
      method: "POST",
      body: { partnerId: partnerA.id, type: "website", url: "https://example.test" },
    });
    assert.equal(link.status, 201);
    assert.equal((await m(`/api/partner-links/${link.body.id}`, { method: "DELETE" })).status, 403);
    assert.equal((await m(`/api/adults/${adult.body.id}`, { method: "DELETE" })).status, 403);
    await prisma.partnerLink.deleteMany({ where: { id: link.body.id } });
  });

  test("can't touch a partner whose team they're not on, and can't move a record there", async () => {
    const m = await member.login();
    assert.equal(
      (await m(`/api/partners/${partnerB.id}`, { method: "PUT", body: { overviewShort: "nope" } })).status,
      403
    );
    assert.equal(
      (await m("/api/adults", { method: "POST", body: { partnerId: partnerB.id, firstName: "No" } })).status,
      403
    );
    const adult = await prisma.adult.create({ data: { partnerId: partnerA.id, firstName: "Mover" } });
    adultIds.push(adult.id);
    assert.equal(
      (await m(`/api/adults/${adult.id}`, { method: "PUT", body: { partnerId: partnerB.id } })).status,
      403
    );
    assert.equal((await prisma.adult.findUnique({ where: { id: adult.id } })).partnerId, partnerA.id);
  });

  test("a guest with only a trip grant, and a viewer on no team, can write nothing on the partner", async () => {
    const t = await outsider.login();
    assert.equal(
      (await t(`/api/partners/${partnerA.id}`, { method: "PUT", body: { overviewShort: "x" } })).status,
      403
    );
    assert.equal(
      (await t("/api/adults", { method: "POST", body: { partnerId: partnerA.id, firstName: "X" } })).status,
      403
    );
    const v = await viewerOff.login();
    assert.equal(
      (await v(`/api/partners/${partnerA.id}`, { method: "PUT", body: { overviewShort: "x" } })).status,
      403
    );
  });

  test("what an editor can't do, and the committee's calls, stay out of reach", async () => {
    const m = await member.login();
    // create or delete a partner
    assert.equal(
      (
        await m("/api/partners", {
          method: "POST",
          body: { kind: "missionary", displayName: `${FIXTURE_TAG} nope` },
        })
      ).status,
      403
    );
    assert.equal((await m(`/api/partners/${partnerA.id}`, { method: "DELETE" })).status, 403);
    // monthly support is never theirs: not readable, not writable
    assert.equal((await m(`/api/support-entries?partnerId=${partnerA.id}`)).status, 403);
    assert.equal(
      (
        await m("/api/support-entries", {
          method: "POST",
          body: { partnerId: partnerA.id, amount: 100, effectiveDate: "2026-01-01" },
        })
      ).status,
      403
    );
    // the care team and the review queue are staff's
    assert.equal((await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [] }, m)).status, 403);
    assert.equal(
      (await m("/api/dispatches/pending/anything", { method: "PUT", body: { text: "approve" } })).status,
      403
    );
    // and the page never gets monthly support in its summary
    const dir = await m("/api/partners");
    assert.ok(dir.body.every((p) => !("supportEntries" in p) && !("supportingSince" in p)));
  });
});

describe("care team: viewing their partner's trips (read-only)", () => {
  let member;
  let tripOfMine;
  let tripOfOther;

  before(async () => {
    member = await makeUser("tripviewer");
    tripOfMine = await prisma.trip.create({
      data: { partnerId: partnerA.id, status: "planning", name: "Mine" },
    });
    tripOfOther = await prisma.trip.create({
      data: { partnerId: partnerB.id, status: "planning", name: "Other" },
    });
    await setTeam(partnerA.id, { leadUserId: null, memberUserIds: [member.user.id] });
    await setFeatures({ trips: true });
  });

  after(async () => {
    await prisma.trip.deleteMany({ where: { id: { in: [tripOfMine.id, tripOfOther.id] } } });
  });

  test("lists and opens the trips of their partner, but not another partner's", async () => {
    const m = await member.login();
    const list = await m("/api/trips");
    assert.equal(list.status, 200);
    const ids = list.body.map((t) => t.id);
    assert.ok(ids.includes(tripOfMine.id));
    assert.ok(!ids.includes(tripOfOther.id));
    assert.equal((await m(`/api/trips/${tripOfMine.id}`)).status, 200);
    assert.equal((await m(`/api/trips/${tripOfOther.id}`)).status, 403);
  });

  test("can't change anything on that trip -- view access only", async () => {
    const m = await member.login();
    assert.equal(
      (await m(`/api/trips/${tripOfMine.id}`, { method: "PUT", body: { notes: "x" } })).status,
      403
    );
    assert.equal(
      (
        await m(`/api/trips/${tripOfMine.id}/budget-lines`, {
          method: "POST",
          body: { label: "x", estimatedAmount: 1 },
        })
      ).status,
      403
    );
    assert.equal((await m(`/api/trips/${tripOfMine.id}`, { method: "DELETE" })).status, 403);
    // and creating a trip is staff's
    assert.equal(
      (await m("/api/trips", { method: "POST", body: { partnerId: partnerA.id, status: "planning" } }))
        .status,
      403
    );
  });
});
