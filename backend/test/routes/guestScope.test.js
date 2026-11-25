// Guest (role: "guest", #356; was "tripLeader") -- a scoped login whose
// reach is exactly its active grants (TripAccess), not one of the 3 full
// roles. Covers the actual security boundary (requireTripScope /
// requirePartnerQueryScope / guestAccess.js, requireAuth.js): read/write on
// granted trips, read-only on those trips' partners, 403 on everything
// else, derived and overridden grant expiry, and users.js's grant
// management (create/update/revoke, orphan deactivation, inactive filter).
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

const GUEST_EMAIL = "route-test-guest@example.test";
const GUEST_PASSWORD = "RouteTestGuest123!";

let admin;
let originalEnabledFeatures;
let partnerA;
let partnerB;
let tripA;
let tripB;
let guestUser;

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

function guestClient() {
  return client({ email: GUEST_EMAIL, password: GUEST_PASSWORD });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();

  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({
    trips: true,
    prayerRequests: true,
    monthlySupport: true,
    oneTimeNeeds: true,
    partnerFiles: true,
    inboundEmail: true,
  });

  const pa = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} guestA` },
  });
  partnerA = pa.body;
  const pb = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} guestB` },
  });
  partnerB = pb.body;

  const ta = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerA.id, status: "planning" },
  });
  tripA = ta.body;
  const tb = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerB.id, status: "planning" },
  });
  tripB = tb.body;

  const passwordHash = await bcrypt.hash(GUEST_PASSWORD, 4); // low cost: throwaway fixture
  // Created straight through Prisma (not POST /api/users) so it skips the
  // forced MFA enrolment a real guest gets, which would otherwise stop
  // this fixture signing in with a password alone.
  guestUser = await prisma.user.upsert({
    where: { email: GUEST_EMAIL },
    update: { passwordHash, role: "guest", active: true },
    create: { email: GUEST_EMAIL, passwordHash, role: "guest", authProvider: "local", active: true },
  });
  await prisma.tripAccess.deleteMany({ where: { userId: guestUser.id } });
  await prisma.tripAccess.create({ data: { userId: guestUser.id, tripId: tripA.id } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: GUEST_EMAIL } }); // cascades its grants
  await removeFixturePartners(); // cascades both fixture trips
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("Guest: trip scope", () => {
  test("reads their own trip", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripA.id}`);
    assert.equal(res.status, 200);
  });

  test("403s reading another trip", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripB.id}`);
    assert.equal(res.status, 403);
  });

  test("writes their own trip (editor-equivalent)", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripA.id}`, {
      method: "PUT",
      body: { notes: "guest note" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.notes, "guest note");
  });

  test("403s writing another trip", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripB.id}`, { method: "PUT", body: { notes: "nope" } });
    assert.equal(res.status, 403);
  });

  test("cannot delete their own trip -- stays admin-only", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripA.id}`, { method: "DELETE" });
    assert.equal(res.status, 403);
  });

  test("cannot clone or generate an application link for their own trip", async () => {
    const guest = await guestClient();
    const clone = await guest(`/api/trips/${tripA.id}/clone`, { method: "POST" });
    assert.equal(clone.status, 403);
    const link = await guest(`/api/trips/${tripA.id}/generate-application-link`, { method: "POST" });
    assert.equal(link.status, 403);
  });

  test("full CRUD on a budget line scoped to their own trip", async () => {
    const guest = await guestClient();
    const created = await guest(`/api/trips/${tripA.id}/budget-lines`, {
      method: "POST",
      body: { label: "Flights", estimatedAmount: 500 },
    });
    assert.equal(created.status, 201);
    const updated = await guest(`/api/trips/budget-lines/${created.body.id}`, {
      method: "PUT",
      body: { estimatedAmount: 600 },
    });
    assert.equal(updated.status, 200);
    const deleted = await guest(`/api/trips/budget-lines/${created.body.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
  });

  test("403s a budget line that belongs to another trip", async () => {
    const otherLine = await admin(`/api/trips/${tripB.id}/budget-lines`, {
      method: "POST",
      body: { label: "Lodging", estimatedAmount: 300 },
    });
    assert.equal(otherLine.status, 201);
    const guest = await guestClient();
    const res = await guest(`/api/trips/budget-lines/${otherLine.body.id}`, {
      method: "PUT",
      body: { estimatedAmount: 1 },
    });
    assert.equal(res.status, 403);
  });

  test("the trips list holds only their granted trips, and planning stays closed", async () => {
    const guest = await guestClient();
    const bare = await guest("/api/trips");
    assert.equal(bare.status, 200);
    assert.deepEqual(
      bare.body.map((t) => t.id),
      [tripA.id],
      "not tripB, which they hold no grant for"
    );
    const planning = await guest("/api/trips/planning");
    assert.equal(planning.status, 403);
    const scoped = await guest(`/api/trips?partnerId=${partnerA.id}`);
    assert.equal(scoped.status, 200);
    const wrongScope = await guest(`/api/trips?partnerId=${partnerB.id}`);
    assert.equal(wrongScope.status, 403);
  });

  // #327 Finding 2: partnerA having a second trip used to mean a Trip
  // Leader's own partner-scoped ?partnerId= query returned every one of
  // that partner's trips, full participant rosters included, not just
  // their own one.
  test("a second trip for their own partner is NOT included in their partner-scoped query", async () => {
    const secondTripForPartnerA = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partnerA.id, status: "planning" },
    });
    try {
      const guest = await guestClient();
      const res = await guest(`/api/trips?partnerId=${partnerA.id}`);
      assert.equal(res.status, 200);
      const ids = res.body.map((t) => t.id);
      assert.ok(ids.includes(tripA.id));
      assert.ok(!ids.includes(secondTripForPartnerA.body.id));
      assert.equal(ids.length, 1);
    } finally {
      await admin(`/api/trips/${secondTripForPartnerA.body.id}`, { method: "DELETE" });
    }
  });

  // #327 Finding 2: tripSchema's full field set (including partnerId) was
  // written straight through on PUT /trips/:id with no per-role filtering
  // -- a guest could re-point their own trip at any partner id, then
  // use that attacker-controlled partnerId to pass requirePartnerQueryScope
  // and read a partner they were never meant to see.
  test("403s re-pointing their own trip at a different partner", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/trips/${tripA.id}`, {
      method: "PUT",
      body: { partnerId: partnerB.id },
    });
    assert.equal(res.status, 403);
    const check = await admin(`/api/trips/${tripA.id}`);
    assert.equal(check.body.partnerId, partnerA.id, "partnerId must be unchanged");
  });
});

describe("Guest: partner scope", () => {
  test("reads only the one Partner tied to their own trip", async () => {
    const guest = await guestClient();
    const ok = await guest(`/api/partners/${partnerA.id}`);
    assert.equal(ok.status, 200);
    const blocked = await guest(`/api/partners/${partnerB.id}`);
    assert.equal(blocked.status, 403);
  });

  // #289: the same directory as everyone, limited by the server to the
  // partners they reach, with the one thing a guest never sees -- money --
  // left out. The booklet's full dump stays closed.
  test("the partner directory lists only their partners, with no monthly support", async () => {
    await prisma.supportEntry.create({
      data: { partnerId: partnerA.id, amount: 4242, effectiveDate: new Date("2026-01-01") },
    });
    try {
      const guest = await guestClient();
      const res = await guest("/api/partners");
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.map((p) => p.id),
        [partnerA.id]
      );
      assert.equal("supportEntries" in res.body[0], false);
      assert.equal("supportingSince" in res.body[0], false);
      assert.ok(!JSON.stringify(res.body).includes("4242"));
      assert.equal((await guest("/api/partners?include=full")).status, 403);
      // staff still get the amount, unchanged
      const staff = await admin("/api/partners");
      assert.equal(staff.body.find((p) => p.id === partnerA.id).supportEntries[0].amount, 4242);
    } finally {
      await prisma.supportEntry.deleteMany({ where: { partnerId: partnerA.id } });
    }
  });

  test("403s another partner's prayer requests even via query filter, allows their own", async () => {
    const guest = await guestClient();
    const blocked = await guest(`/api/prayer-requests?partnerId=${partnerB.id}`);
    assert.equal(blocked.status, 403);
    const ok = await guest(`/api/prayer-requests?partnerId=${partnerA.id}`);
    assert.equal(ok.status, 200);
  });

  // #289: the consolidated list is open to a guest, limited by the server to
  // the partners they reach -- never everyone's.
  test("an unfiltered prayer request list holds only their partners' rows", async () => {
    const mk = (partnerId, text) =>
      prisma.prayerRequest.create({
        data: { partnerId, category: "situational", requestText: text, dateReceived: new Date("2026-01-01") },
      });
    const mine = await mk(partnerA.id, "guest-list-mine");
    const theirs = await mk(partnerB.id, "guest-list-theirs");
    try {
      const guest = await guestClient();
      const res = await guest("/api/prayer-requests");
      assert.equal(res.status, 200);
      const ids = res.body.map((r) => r.id);
      assert.ok(ids.includes(mine.id));
      assert.ok(!ids.includes(theirs.id));
      assert.ok(res.body.every((r) => r.partnerId === partnerA.id));
    } finally {
      await prisma.prayerRequest.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
    }
  });
});

// #329 Finding 1: the unmatched-inbound-email queue isn't attached to any
// partner or trip (that's the whole point -- it's mail nobody could match
// yet), so there's no sensible scoped version of it for a guest to
// see. Excluded entirely rather than scoped, same as GET /api/partners
// above.
describe("Guest: inbound email queue blocked entirely", () => {
  let queued;

  before(async () => {
    queued = await prisma.inboundEmail.create({
      data: {
        fromAddress: `${FIXTURE_TAG}-unmatched@example.test`,
        subject: "Unmatched",
        fileName: "unmatched.eml",
        bytesRow: { create: { bytes: Buffer.from("From: nobody@example.test\r\n\r\nHi") } },
      },
    });
  });

  after(async () => {
    await prisma.inboundEmail.deleteMany({ where: { id: queued.id } }).catch(() => {});
  });

  test("403s the queue list", async () => {
    const guest = await guestClient();
    const res = await guest("/api/inbound-email");
    assert.equal(res.status, 403);
  });

  test("403s reading one queued email's raw .eml", async () => {
    const guest = await guestClient();
    const res = await guest(`/api/inbound-email/${queued.id}/raw`);
    assert.equal(res.status, 403);
  });

  test("admin still reads the queue -- only guest is excluded", async () => {
    const res = await admin("/api/inbound-email");
    assert.equal(res.status, 200);
  });
});

// #327 Finding 3: a guest scoped to tripA could mark ANY
// participant id complete against one of tripA's own requirements --
// requireTripScope confirmed the caller's own trip matched the
// requirement's trip, but :participantId itself was never checked against
// that same trip, so a participant belonging to a completely different
// trip (tripB here) worked too.
describe("Guest: cross-trip IDOR on requirement completion", () => {
  let requirement;
  let tripBParticipant;

  before(async () => {
    const req = await admin(`/api/trips/${tripA.id}/requirements`, {
      method: "POST",
      body: { label: "Passport copy", kind: "task" },
    });
    requirement = req.body;
    const participant = await admin(`/api/trips/${tripB.id}/participants`, {
      method: "POST",
      body: { firstName: "Other", lastName: "Trip", email: "route-test-tripb-participant@example.test" },
    });
    assert.equal(participant.status, 201);
    tripBParticipant = participant.body;
  });

  test("404s marking a different trip's participant complete", async () => {
    const guest = await guestClient();
    const res = await guest(
      `/api/trips/requirements/${requirement.id}/participants/${tripBParticipant.id}/complete`,
      {
        method: "PUT",
        body: { completed: true },
      }
    );
    assert.equal(res.status, 404);
  });

  test("the guest can still mark their own trip's participant complete", async () => {
    const participant = await admin(`/api/trips/${tripA.id}/participants`, {
      method: "POST",
      body: { firstName: "Own", lastName: "Trip", email: "route-test-tripa-participant@example.test" },
    });
    assert.equal(participant.status, 201);
    const guest = await guestClient();
    const res = await guest(
      `/api/trips/requirements/${requirement.id}/participants/${participant.body.id}/complete`,
      {
        method: "PUT",
        body: { completed: true },
      }
    );
    assert.equal(res.status, 200);
  });
});

// #327 Finding 2 (lower-value gaps): neither route has a legitimate Trip
// Leader use case -- church-wide trip settings config and a cross-church
// subscriber-count summary, neither scoped to any one trip.
describe("Guest: settings/digest-summary reads blocked", () => {
  test("403s GET /api/settings/trips", async () => {
    const guest = await guestClient();
    const res = await guest("/api/settings/trips");
    assert.equal(res.status, 403);
  });

  test("a guest still sees whether trip budgeting is on, through their own trip (#370)", async () => {
    const guest = await guestClient();
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enableTripBudgeting: true },
    });
    try {
      for (const on of [true, false]) {
        await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enableTripBudgeting: on } });
        const res = await guest(`/api/trips/${tripA.id}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.enableTripBudgeting, on);
        // ...and nothing else from the closed settings route came along with it.
        assert.equal(res.body.onlineGivingInstructions, undefined);
        assert.equal(res.body.tripQuestionLibrary, undefined);
      }
    } finally {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: { enableTripBudgeting: before?.enableTripBudgeting ?? false },
      });
    }
  });

  test("403s GET /api/scoped-digest/summary", async () => {
    const guest = await guestClient();
    const res = await guest("/api/scoped-digest/summary");
    assert.equal(res.status, 403);
  });

  test("admin still reads both -- only guest is excluded", async () => {
    const settings = await admin("/api/settings/trips");
    assert.equal(settings.status, 200);
    const digest = await admin("/api/scoped-digest/summary");
    assert.equal(digest.status, 200);
  });
});

// #350: same exclusion pattern as #329's inbound-email fix above -- this
// queue holds the exact text about to go out churchwide, unfiltered and
// not attached to any one trip, so there's no sensible trip-scoped
// version of it.
describe("Guest: Pending Dispatches queue blocked entirely", () => {
  test("403s the pending queue", async () => {
    const guest = await guestClient();
    const res = await guest("/api/dispatches/pending");
    assert.equal(res.status, 403);
  });

  test("admin still reads the queue -- only guest is excluded", async () => {
    const res = await admin("/api/dispatches/pending");
    assert.equal(res.status, 200);
  });
});

// #356: reverses #329 Finding 2. A guest used to be fully admin-managed
// (no self-service password or MFA, on the frontend or the backend); they
// now get a "My account" page, so change-password and MFA enrolment work
// for them. MFA is required for the role, so unlike every other role they
// can enrol but never switch it off.
describe("Guest: password/MFA self-service", () => {
  const SELF_EMAIL = "route-test-guest-selfservice@example.test";
  const SELF_PASSWORD = "RouteTestGuestSelf123!";
  let selfUser;

  before(async () => {
    const passwordHash = await bcrypt.hash(SELF_PASSWORD, 4);
    selfUser = await prisma.user.upsert({
      where: { email: SELF_EMAIL },
      update: { passwordHash, role: "guest", active: true, mfaEnabled: false, mfaSecret: null },
      create: { email: SELF_EMAIL, passwordHash, role: "guest", authProvider: "local", active: true },
    });
    await prisma.tripAccess.deleteMany({ where: { userId: selfUser.id } });
    await prisma.tripAccess.create({ data: { userId: selfUser.id, tripId: tripA.id } });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { email: SELF_EMAIL } });
  });

  test("changes their own password, then signs in with the new one", async () => {
    const self = await client({ email: SELF_EMAIL, password: SELF_PASSWORD });
    const res = await self("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: SELF_PASSWORD, newPassword: "BrandNewGuestPass123!" },
    });
    assert.equal(res.status, 200);
    const again = await client({ email: SELF_EMAIL, password: "BrandNewGuestPass123!" });
    assert.equal((await again(`/api/trips/${tripA.id}`)).status, 200);
  });

  test("a wrong current password is still refused", async () => {
    const self = await client({ email: SELF_EMAIL, password: "BrandNewGuestPass123!" });
    const res = await self("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: "not-the-password", newPassword: "AnotherNewPass123!" },
    });
    assert.notEqual(res.status, 200);
  });

  test("starts MFA enrolment from a normal session", async () => {
    const self = await client({ email: SELF_EMAIL, password: "BrandNewGuestPass123!" });
    const res = await self("/api/auth/mfa/setup", { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(res.body.secret);
    assert.ok(res.body.qrCode);
  });

  // No rule is specific to a guest (#385): switching two-factor off is blocked for everyone
  // only while the church requires it, and a reset sends the account back through enrolment
  // because login sends every unenrolled account there. Both are in twoFactorRequirement.test.js.
  test("an admin MFA reset clears the guest's authenticator", async () => {
    await prisma.user.update({
      where: { id: selfUser.id },
      data: { mfaEnabled: true, mfaSecret: "placeholder", mfaSetupRequired: false },
    });
    const res = await admin(`/api/users/${selfUser.id}/mfa/reset`, { method: "POST" });
    assert.equal(res.status, 200);
    const row = await prisma.user.findUnique({ where: { id: selfUser.id } });
    assert.equal(row.mfaEnabled, false);
    assert.equal(row.mfaSecret, null);
  });

  test("a full admin/editor/viewer session is unaffected", async () => {
    // mfa/setup only generates a secret/QR code (mfaEnabled stays false
    // until /mfa/verify-setup confirms a real code), so this doesn't
    // disturb the admin fixture's own login for any other test in this
    // file -- still, clear the leftover mfaSecret afterward so this
    // fixture's row is exactly as ensureTestUsers() left it for whatever
    // runs next.
    const res = await admin("/api/auth/mfa/setup", { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(res.body.secret);
    assert.ok(res.body.qrCode);
    await prisma.user.update({
      where: { email: TEST_USERS.admin.email },
      data: { mfaSecret: null },
    });
  });
});

describe("Guest (trip grant): Monthly Support and One-Time Needs blocked, Newsletters & Docs allowed", () => {
  let fileA;
  let fileB;

  before(async () => {
    await prisma.supportEntry.create({
      data: { partnerId: partnerA.id, amount: 500, effectiveDate: new Date("2026-01-01") },
    });
    await prisma.supportNeed.create({
      data: {
        partnerId: partnerA.id,
        description: "New laptop",
        requestedAmount: 800,
        requestDate: new Date("2026-01-01"),
      },
    });
    fileA = await prisma.partnerFile.create({
      data: {
        partnerId: partnerA.id,
        kind: "newsletter",
        receivedDate: new Date("2026-01-01"),
        fileName: "a.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture-a") } },
      },
    });
    fileB = await prisma.partnerFile.create({
      data: {
        partnerId: partnerB.id,
        kind: "newsletter",
        receivedDate: new Date("2026-01-01"),
        fileName: "b.pdf",
        contentType: "application/pdf",
        bytesRow: { create: { bytes: Buffer.from("%PDF-fixture-b") } },
      },
    });
  });

  after(async () => {
    await prisma.supportEntry.deleteMany({ where: { partnerId: partnerA.id } });
    await prisma.supportNeed.deleteMany({ where: { partnerId: partnerA.id } });
    await prisma.partnerFile.deleteMany({ where: { partnerId: { in: [partnerA.id, partnerB.id] } } });
  });

  test("403s Monthly Support for their own linked partner, not just a mismatched one", async () => {
    const guest = await guestClient();
    const own = await guest(`/api/support-entries?partnerId=${partnerA.id}`);
    assert.equal(own.status, 403);
    const unfiltered = await guest("/api/support-entries");
    assert.equal(unfiltered.status, 403);
  });

  // #289: one-time needs are a care team view -- read in full, notes included,
  // only for partners whose team the person is on (see careTeam.test.js). A
  // trip leader's smaller scope (a trip grant) never includes them, and
  // Monthly Support, above, stays closed entirely.
  test("a trip leader can't read One-Time Needs, even for their own trip's partner", async () => {
    const guest = await guestClient();
    assert.equal((await guest(`/api/support-needs?partnerId=${partnerA.id}`)).status, 403);
    assert.equal((await guest(`/api/support-needs?partnerId=${partnerB.id}`)).status, 403);
    // an unfiltered list is just empty, never someone else's rows
    const list = await guest("/api/support-needs");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, []);
  });

  test("a guest holding only a trip grant can't write either", async () => {
    const guest = await guestClient();
    const prayer = await guest("/api/prayer-requests", {
      method: "POST",
      body: { partnerId: partnerA.id, category: "situational", requestText: "x", dateReceived: "2026-01-01" },
    });
    assert.equal(prayer.status, 403);
    const need = await guest("/api/support-needs", {
      method: "POST",
      body: { partnerId: partnerA.id, description: "x", requestedAmount: 1, requestDate: "2026-01-01" },
    });
    assert.equal(need.status, 403);
  });

  test("reads Newsletters & Docs for their own linked partner, in full", async () => {
    const guest = await guestClient();
    const ok = await guest(`/api/partner-files?partnerId=${partnerA.id}`);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.some((f) => f.id === fileA.id));
    const blocked = await guest(`/api/partner-files?partnerId=${partnerB.id}`);
    assert.equal(blocked.status, 403);
  });

  test("an unfiltered Newsletters & Docs list holds only their partners' files", async () => {
    const guest = await guestClient();
    const res = await guest("/api/partner-files");
    assert.equal(res.status, 200);
    const ids = res.body.map((f) => f.id);
    assert.ok(ids.includes(fileA.id));
    assert.ok(!ids.includes(fileB.id));
  });

  test("downloads their own linked partner's file, 403s another partner's by id", async () => {
    const guest = await guestClient();
    const ok = await guest(`/api/partner-files/${fileA.id}/download`);
    assert.equal(ok.status, 200);
    const blocked = await guest(`/api/partner-files/${fileB.id}/download`);
    assert.equal(blocked.status, 403);
  });
});

// ---------------------------------------------------------------------
// #356: grants. Effective expiry is derived at check time from the trip's
// end date + 30 days; an admin-set expiresAt on the grant overrides it
// either way.
// ---------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
function utcDateDaysAgo(days) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

// A throwaway guest with a password login and no grants, so a test can
// give it exactly the grants it's about to exercise.
async function makeGuest(tag) {
  const email = `route-test-guest-${tag}@example.test`;
  const password = "RouteTestGuest123!";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "guest", active: true },
    create: { email, passwordHash, role: "guest", authProvider: "local", active: true },
  });
  await prisma.tripAccess.deleteMany({ where: { userId: user.id } });
  return { user, email, password, login: () => client({ email, password }) };
}

describe("Guest: derived and overridden grant expiry", () => {
  let g;
  let trip;

  before(async () => {
    g = await makeGuest("expiry");
    trip = await prisma.trip.create({
      data: { partnerId: partnerA.id, status: "completed", endDate: utcDateDaysAgo(10) },
    });
    await prisma.tripAccess.create({ data: { userId: g.user.id, tripId: trip.id } });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { id: g.user.id } });
    await prisma.trip.deleteMany({ where: { id: trip.id } });
  });

  async function status() {
    return (await (await g.login())(`/api/trips/${trip.id}`)).status;
  }
  async function setTrip(data) {
    await prisma.trip.update({ where: { id: trip.id }, data });
  }
  async function setGrant(expiresAt) {
    await prisma.tripAccess.updateMany({
      where: { userId: g.user.id, tripId: trip.id },
      data: { expiresAt },
    });
  }

  test("still works 10 days after the trip ended (within the 30-day window)", async () => {
    assert.equal(await status(), 200);
  });

  test("lapses once the trip ended more than 30 days ago", async () => {
    await setTrip({ endDate: utcDateDaysAgo(40) });
    assert.equal(await status(), 401);
  });

  test("still works through the last day of the window, not just before it", async () => {
    await setTrip({ endDate: utcDateDaysAgo(30) });
    assert.equal(await status(), 200);
  });

  test("changing the trip's end date moves the expiry with it", async () => {
    await setTrip({ endDate: utcDateDaysAgo(40) });
    assert.equal(await status(), 401);
    await setTrip({ endDate: utcDateDaysAgo(5) });
    assert.equal(await status(), 200);
  });

  test("a trip with no end date never lapses on its own", async () => {
    await setTrip({ endDate: null });
    assert.equal(await status(), 200);
  });

  test("an override in the past ends access now, even before the derived date", async () => {
    await setTrip({ endDate: utcDateDaysAgo(-30) }); // ends in 30 days
    await setGrant(new Date(Date.now() - 60_000));
    assert.equal(await status(), 401);
  });

  test("an override in the future extends access past the derived date", async () => {
    await setTrip({ endDate: utcDateDaysAgo(90) }); // derived expiry long past
    await setGrant(null);
    assert.equal(await status(), 401);
    await setGrant(new Date(Date.now() + 5 * DAY_MS));
    assert.equal(await status(), 200);
  });

  test("clearing the override returns to the derived date", async () => {
    await setGrant(null);
    assert.equal(await status(), 401);
  });
});

describe("Guest: several grants", () => {
  let g;
  let tripC;
  let partnerC;

  before(async () => {
    g = await makeGuest("multi");
    const pc = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} guestC` },
    });
    partnerC = pc.body;
    tripC = (
      await admin("/api/trips", { method: "POST", body: { partnerId: partnerC.id, status: "planning" } })
    ).body;
    await prisma.tripAccess.createMany({
      data: [
        { userId: g.user.id, tripId: tripA.id },
        { userId: g.user.id, tripId: tripB.id },
      ],
    });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { id: g.user.id } });
  });

  test("reads and writes every granted trip, 403s one it holds no grant for", async () => {
    const guest = await g.login();
    assert.equal((await guest(`/api/trips/${tripA.id}`)).status, 200);
    assert.equal((await guest(`/api/trips/${tripB.id}`)).status, 200);
    assert.equal(
      (await guest(`/api/trips/${tripB.id}`, { method: "PUT", body: { notes: "multi" } })).status,
      200
    );
    assert.equal((await guest(`/api/trips/${tripC.id}`)).status, 403);
  });

  test("reads the partner of every granted trip, not of an ungranted one", async () => {
    const guest = await g.login();
    assert.equal((await guest(`/api/partners/${partnerA.id}`)).status, 200);
    assert.equal((await guest(`/api/partners/${partnerB.id}`)).status, 200);
    assert.equal((await guest(`/api/partners/${partnerC.id}`)).status, 403);
    assert.equal((await guest(`/api/prayer-requests?partnerId=${partnerB.id}`)).status, 200);
    assert.equal((await guest(`/api/prayer-requests?partnerId=${partnerC.id}`)).status, 403);
  });

  test("the partner-scoped trip list returns only the granted trips of that partner", async () => {
    const guest = await g.login();
    const a = await guest(`/api/trips?partnerId=${partnerA.id}`);
    assert.deepEqual(
      a.body.map((t) => t.id),
      [tripA.id]
    );
    const c = await guest(`/api/trips?partnerId=${partnerC.id}`);
    assert.equal(c.status, 403);
  });

  test("the notification summary resolves for a multi-trip guest", async () => {
    const guest = await g.login();
    assert.equal((await guest("/api/notifications/summary")).status, 200);
  });

  test("a guest with grants on trips for the same partner is not given its other trips", async () => {
    const extra = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partnerA.id, status: "planning" },
    });
    try {
      const guest = await g.login();
      const res = await guest(`/api/trips?partnerId=${partnerA.id}`);
      assert.ok(!res.body.map((t) => t.id).includes(extra.body.id));
      assert.equal((await guest(`/api/trips/${extra.body.id}`)).status, 403);
    } finally {
      await admin(`/api/trips/${extra.body.id}`, { method: "DELETE" });
    }
  });

  test("/me lists each active grant, labelling the partner by displayName not fieldDisplayName", async () => {
    await prisma.partner.update({ where: { id: partnerA.id }, data: { fieldDisplayName: "Field Alias A" } });
    try {
      const guest = await g.login();
      const me = await guest("/api/auth/me");
      assert.equal(me.status, 200);
      const forA = me.body.user.guestTrips.find((t) => t.id === tripA.id);
      assert.equal(forA.partnerId, partnerA.id);
      assert.equal(forA.partnerLabel, partnerA.displayName);
      assert.equal(me.body.user.guestTrips.length, 2);
      assert.equal(me.body.user.scopedTripId, undefined);
    } finally {
      await prisma.partner.update({ where: { id: partnerA.id }, data: { fieldDisplayName: null } });
    }
  });
});

describe("users.js: guest accounts and grants", () => {
  const created = [];
  after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  });

  test("rejects creating a guest with no trip", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-g-no-trip@example.test", role: "guest", password: "Password123!" },
    });
    assert.equal(res.status, 400);
  });

  test("rejects creating a guest for a trip that doesn't exist", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-g-bad-trip@example.test",
        role: "guest",
        tripAccess: [{ tripId: "00000000-0000-0000-0000-000000000000" }],
        password: "Password123!",
      },
    });
    assert.equal(res.status, 400);
  });

  test("the old tripLeader role and scopedTripId are no longer accepted", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-g-old@example.test", role: "tripLeader", password: "Password123!" },
    });
    assert.equal(res.status, 400);
  });

  test("creates a guest with its grants, and requires MFA only when asked (no rule is specific to a guest)", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-g-good@example.test",
        role: "guest",
        tripAccess: [{ tripId: tripA.id }, { tripId: tripB.id, expiresAt: "2099-01-31" }],
        password: "Password123!",
        requireMfa: false,
      },
    });
    assert.equal(res.status, 201);
    created.push(res.body.id);
    assert.equal(res.body.role, "guest");
    assert.equal(res.body.mfaSetupRequired, false);
    assert.equal(res.body.inactiveReason, null);
    assert.deepEqual(res.body.tripAccess.map((g) => g.tripId).sort(), [tripA.id, tripB.id].sort());
    const override = res.body.tripAccess.find((g) => g.tripId === tripB.id);
    assert.equal(override.expiresIsOverride, true);
    assert.equal(new Date(override.effectiveExpiresAt).toISOString(), "2099-01-31T23:59:59.999Z");
  });

  test("changing a guest to a full role clears its grants and keeps the account active", async () => {
    const made = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-g-switch@example.test",
        role: "guest",
        tripAccess: [{ tripId: tripA.id }],
        password: "Password123!",
      },
    });
    assert.equal(made.status, 201);
    created.push(made.body.id);
    const res = await admin(`/api/users/${made.body.id}`, { method: "PUT", body: { role: "viewer" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tripAccess, []);
    assert.equal(res.body.active, true);
    const row = await prisma.user.findUnique({ where: { id: made.body.id } });
    assert.equal(row.active, true, "leaving the guest role must not deactivate the account");
    assert.equal(await prisma.tripAccess.count({ where: { userId: made.body.id } }), 0);
  });

  test("changing a full role to guest needs a trip, and stores it when given", async () => {
    const made = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-g-promote@example.test", role: "viewer", password: "Password123!" },
    });
    created.push(made.body.id);
    const bare = await admin(`/api/users/${made.body.id}`, { method: "PUT", body: { role: "guest" } });
    assert.equal(bare.status, 400);
    const ok = await admin(`/api/users/${made.body.id}`, {
      method: "PUT",
      body: { role: "guest", tripAccess: [{ tripId: tripA.id }] },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.mfaSetupRequired, false);
    assert.equal(ok.body.tripAccess.length, 1);
  });

  test("only an admin may manage grants", async () => {
    const editor = await client("editor");
    const res = await editor(`/api/users/${guestUser.id}/trip-access`);
    assert.equal(res.status, 403);
    const post = await editor(`/api/users/${guestUser.id}/trip-access`, {
      method: "POST",
      body: { tripId: tripB.id },
    });
    assert.equal(post.status, 403);
  });

  test("refuses a grant on a non-guest account", async () => {
    const made = await admin("/api/users", {
      method: "POST",
      body: { email: "route-test-g-nonguest@example.test", role: "editor", password: "Password123!" },
    });
    created.push(made.body.id);
    const res = await admin(`/api/users/${made.body.id}/trip-access`, {
      method: "POST",
      body: { tripId: tripA.id },
    });
    assert.equal(res.status, 400);
  });
});

describe("users.js: grant lifecycle, orphan deactivation and the inactive filter", () => {
  let g;

  before(async () => {
    g = await makeGuest("lifecycle");
    await prisma.tripAccess.create({ data: { userId: g.user.id, tripId: tripA.id } });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { id: g.user.id } });
  });

  test("granting another trip gives immediate access, and lists on the trip's access panel", async () => {
    const guest = await g.login();
    assert.equal((await guest(`/api/trips/${tripB.id}`)).status, 403);
    const res = await admin(`/api/users/${g.user.id}/trip-access`, {
      method: "POST",
      body: { tripId: tripB.id },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.tripAccess.length, 2);
    assert.equal((await guest(`/api/trips/${tripB.id}`)).status, 200);
    const byTrip = await admin(`/api/users/by-trip/${tripB.id}`);
    assert.equal(byTrip.status, 200);
    assert.ok(byTrip.body.some((x) => x.user.id === g.user.id && x.active));
  });

  test("ending a grant now stops that trip's access on the next request; clearing restores the derived date", async () => {
    const guest = await g.login();
    const end = await admin(`/api/users/${g.user.id}/trip-access/${tripB.id}`, {
      method: "PUT",
      body: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    assert.equal(end.status, 200);
    assert.equal((await guest(`/api/trips/${tripB.id}`)).status, 403);
    assert.equal((await guest(`/api/trips/${tripA.id}`)).status, 200, "their other grant is untouched");
    const restore = await admin(`/api/users/${g.user.id}/trip-access/${tripB.id}`, {
      method: "PUT",
      body: { expiresAt: null },
    });
    assert.equal(restore.status, 200);
    assert.equal((await guest(`/api/trips/${tripB.id}`)).status, 200);
  });

  test("a bad date is rejected", async () => {
    const res = await admin(`/api/users/${g.user.id}/trip-access/${tripB.id}`, {
      method: "PUT",
      body: { expiresAt: "not a date" },
    });
    assert.equal(res.status, 400);
  });

  test("removing one of several grants leaves the account active", async () => {
    const res = await admin(`/api/users/${g.user.id}/trip-access/${tripB.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.body.deactivated, false);
    const row = await prisma.user.findUnique({ where: { id: g.user.id } });
    assert.equal(row.active, true);
  });

  test("an expired-only guest is listed as inactive, an active one is not", async () => {
    await prisma.tripAccess.updateMany({
      where: { userId: g.user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const all = await admin("/api/users");
    const mine = all.body.find((u) => u.id === g.user.id);
    assert.equal(mine.inactiveReason, "expired");
    const inactive = await admin("/api/users?inactive=true");
    assert.ok(inactive.body.some((u) => u.id === g.user.id));
    assert.ok(
      !inactive.body.some((u) => u.email === GUEST_EMAIL),
      "the fixture guest still has a live grant"
    );
    assert.ok(!inactive.body.some((u) => u.role !== "guest"), "full roles are never listed as inactive");
    await prisma.tripAccess.updateMany({ where: { userId: g.user.id }, data: { expiresAt: null } });
  });

  test("the Users & access report derives a guest's status and expiry from their grants", async () => {
    // Both of this guest's grants are still lapsed from the test above.
    await prisma.tripAccess.updateMany({
      where: { userId: g.user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await admin("/api/reports/users-access?includeInactive=true");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.name === g.email);
    assert.equal(row.role, "guest");
    assert.equal(row.status, "Expired");
    await prisma.tripAccess.updateMany({ where: { userId: g.user.id }, data: { expiresAt: null } });
    const live = await admin("/api/reports/users-access?includeInactive=true");
    assert.equal(live.body.rows.find((r) => r.name === g.email).status, "Active");
  });

  test("removing the last grant deactivates the guest, and ends their session", async () => {
    const guest = await g.login();
    assert.equal((await guest(`/api/trips/${tripA.id}`)).status, 200);
    const res = await admin(`/api/users/${g.user.id}/trip-access/${tripA.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.body.deactivated, true);
    assert.equal((await guest(`/api/trips/${tripA.id}`)).status, 401);

    const row = await prisma.user.findUnique({ where: { id: g.user.id } });
    assert.equal(row.active, false);

    const inactive = await admin("/api/users?inactive=true");
    const mine = inactive.body.find((u) => u.id === g.user.id);
    assert.equal(mine.inactiveReason, "deactivated");
  });

  test("granting access to a deactivated guest does not silently reactivate the account", async () => {
    const res = await admin(`/api/users/${g.user.id}/trip-access`, {
      method: "POST",
      body: { tripId: tripA.id },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.accountActive, false);
    const row = await prisma.user.findUnique({ where: { id: g.user.id } });
    assert.equal(row.active, false);
  });

  test("deleting a trip leaves its guests with no access, listed as inactive", async () => {
    const doomed = await prisma.trip.create({ data: { partnerId: partnerA.id, status: "planning" } });
    const solo = await makeGuest("orphaned-trip");
    await prisma.tripAccess.create({ data: { userId: solo.user.id, tripId: doomed.id } });
    try {
      await prisma.trip.delete({ where: { id: doomed.id } });
      const guest = await solo.login();
      assert.equal((await guest("/api/auth/me")).status, 401);
      const all = await admin("/api/users");
      assert.equal(all.body.find((u) => u.id === solo.user.id).inactiveReason, "no_access");
    } finally {
      await prisma.user.deleteMany({ where: { id: solo.user.id } });
    }
  });
});
