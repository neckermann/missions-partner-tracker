// #409: a care team seat sees a trip's names and dates only. A guest who can read a trip only
// because they sit on its partner's care team gets no tokens, personal details, applications,
// documents or money; a trip leader holding a grant, and the full roles, still see everything.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

const PASSWORD = "SeatViewTest123!";
const emails = [];
let anon;
let features;

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const as =
  (cookie) =>
  (path, options = {}) =>
    anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });

async function makeGuest(tag) {
  const email = `route-test-seatview-${tag}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = { passwordHash, role: "guest", active: true, authProvider: "local" };
  const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  return { user, email };
}
const login = (email) => anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  features = (await prisma.churchSettings.findUnique({ where: { id: "singleton" } }))?.enabledFeatures ?? {};
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: { ...features, careTeam: true, trips: true } },
    create: { id: "singleton", enabledFeatures: { careTeam: true, trips: true } },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: features } });
  await removeTestUsers();
  await stopServer();
});

test("no tokens, personal details, applications, documents or money for a seat; a trip leader still sees all", async () => {
  const partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: "[route-test] seat view", sentByOurChurch: false },
  });
  try {
    const trip = await prisma.trip.create({
      data: {
        partnerId: partner.id,
        name: "[route-test] seat trip",
        status: "planning",
        applicationShareToken: "secret-apply-token",
        startDate: new Date("2027-03-01"),
        endDate: new Date("2027-03-10"),
      },
    });
    const participant = await prisma.tripParticipant.create({
      data: {
        tripId: trip.id,
        firstName: "Pat",
        lastName: "Member",
        email: "pat@example.test",
        dateOfBirth: new Date("1990-01-02"),
        shareToken: "secret-share-token",
      },
    });
    await prisma.tripApplication.create({
      data: {
        tripId: trip.id,
        firstName: "Dee",
        lastName: "Declined",
        email: "dee@example.test",
        status: "declined",
        declinedReason: "staff note",
      },
    });
    await prisma.tripContribution.create({
      data: {
        tripId: trip.id,
        participantId: participant.id,
        donorName: "Donor",
        donorEmail: "donor@example.test",
        amount: 500,
        method: "check",
        receivedDate: new Date("2027-01-05"),
      },
    });
    const doc = await prisma.tripDocument.create({
      data: {
        tripId: trip.id,
        participantId: participant.id,
        fileName: "passport.pdf",
        contentType: "application/pdf",
      },
    });
    await prisma.tripDocumentBytes.create({ data: { id: doc.id, bytes: Buffer.from("%PDF-1.4 secret") } });

    const seat = await makeGuest("seat");
    const leader = await makeGuest("leader");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: seat.user.id } });
    await prisma.tripAccess.create({ data: { userId: leader.user.id, tripId: trip.id } });
    const asSeat = as(cookieOf(await login(seat.email)));
    const asLeader = as(cookieOf(await login(leader.email)));

    const seen = await asSeat(`/api/trips/${trip.id}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.name, "[route-test] seat trip");
    assert.ok(seen.body.startDate && seen.body.endDate, "names and dates");
    assert.deepEqual(
      seen.body.participants.map((p) => [p.firstName, p.lastName, Object.keys(p).sort().join()]),
      [["Pat", "Member", "firstName,id,lastName,tripId"]],
      "the team's names, and nothing else about them"
    );
    const text = JSON.stringify(seen.body);
    for (const secret of [
      "secret-apply-token",
      "secret-share-token",
      "1990-01-02",
      "pat@example.test",
      "donor@example.test",
      "staff note",
      "Dee",
    ]) {
      assert.ok(!text.includes(secret), `the seat's view must not contain ${secret}`);
    }
    assert.deepEqual(seen.body.contributions, []);
    assert.deepEqual(seen.body.documents, []);
    assert.deepEqual(seen.body.applications, []);

    const list = await asSeat(`/api/trips?partnerId=${partner.id}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.ok(!JSON.stringify(list.body).includes("secret-apply-token"));
    assert.equal((await asSeat(`/api/trips/${trip.id}/applications`)).status, 403);
    assert.equal((await asSeat(`/api/trips/documents/${doc.id}/download`)).status, 403);

    // The trip's own leader, holding a grant, is unaffected.
    const full = await asLeader(`/api/trips/${trip.id}`);
    assert.equal(full.status, 200);
    assert.equal(full.body.applicationShareToken, "secret-apply-token");
    assert.equal(full.body.participants[0].email, "pat@example.test");
    assert.equal((await asLeader(`/api/trips/${trip.id}/applications`)).status, 200);
    assert.equal((await asLeader(`/api/trips/documents/${doc.id}/download`)).status, 200);
  } finally {
    await prisma.partner.delete({ where: { id: partner.id } });
  }
});
