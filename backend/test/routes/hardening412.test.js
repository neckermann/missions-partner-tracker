// Smaller hardening items: ids in trip child writes must belong to the trip; the emailed
// sign-in link is throttled per account and audits only real accounts; a record's source file
// must be the same partner's; only staff attribute a contact to someone else; passkey
// challenges are single-use through the database; the passkey relying party can't come from a
// request header in production.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { signChallenge, consumeChallenge, relyingParty } = require("../../src/utils/passkeys");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const PASSWORD = "Hardening412Test!";
const emails = [];
let anon;
let admin;
let editor;
let original;

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const as =
  (cookie) =>
  (path, options = {}) =>
    anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeGuest(tag) {
  const email = `route-test-412-${tag}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = { passwordHash, role: "guest", active: true, authProvider: "local" };
  const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  return { user, email };
}
const login = (email) => anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
const newPartner = async (tag) =>
  (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} 412 ${tag}` },
    })
  ).body;

before(async () => {
  await ensureTestUsers();
  [anon, admin, editor] = await Promise.all([client(null), client("admin"), client("editor")]);
  await removeFixturePartners();
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      enabledFeatures: {
        ...(original?.enabledFeatures || {}),
        trips: true,
        careTeam: true,
        contactLog: true,
        outboundEmail: true,
      },
    },
    create: {
      id: "singleton",
      enabledFeatures: { trips: true, careTeam: true, contactLog: true, outboundEmail: true },
    },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await removeFixturePartners();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      enabledFeatures: original?.enabledFeatures ?? {},
      requirePasswordless: original?.requirePasswordless ?? false,
      postmarkServerToken: original?.postmarkServerToken ?? null,
      emailFromAddress: original?.emailFromAddress ?? null,
    },
  });
  await removeTestUsers();
  await stopServer();
});

describe("ids in a trip's child records must belong to that trip", () => {
  test("a guest on trip A can't attach, overwrite or read trip B's people and requirements", async () => {
    const partner = await newPartner("trips");
    const tripA = (
      await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, name: `${FIXTURE_TAG} A`, status: "planning" },
      })
    ).body;
    const tripB = (
      await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, name: `${FIXTURE_TAG} B`, status: "planning" },
      })
    ).body;
    const personB = await prisma.tripParticipant.create({
      data: { tripId: tripB.id, firstName: "Bea", lastName: "Other" },
    });
    const requirementB = await prisma.tripRequirement.create({
      data: { tripId: tripB.id, label: "B waiver", kind: "document" },
    });
    const personA = await prisma.tripParticipant.create({
      data: { tripId: tripA.id, firstName: "Al", lastName: "Own" },
    });
    const { user, email } = await makeGuest("leader");
    await prisma.tripAccess.create({ data: { userId: user.id, tripId: tripA.id } });
    const leader = as(cookieOf(await login(email)));

    // Flight segments: another trip's person is refused; the trip's own person is fine.
    const flight = { airline: "Air", flightNumber: "1" };
    assert.equal(
      (
        await leader(`/api/trips/${tripA.id}/flight-segments`, {
          method: "POST",
          body: { ...flight, participantIds: [personB.id] },
        })
      ).status,
      400
    );
    const okFlight = await leader(`/api/trips/${tripA.id}/flight-segments`, {
      method: "POST",
      body: { ...flight, participantIds: [personA.id] },
    });
    assert.equal(okFlight.status, 201, JSON.stringify(okFlight.body));
    assert.equal(
      (
        await leader(`/api/trips/flight-segments/${okFlight.body.id}`, {
          method: "PUT",
          body: { participantIds: [personB.id] },
        })
      ).status,
      400
    );
    assert.equal(
      await prisma.tripParticipant.count({ where: { id: personB.id, flightSegments: { some: {} } } }),
      0
    );

    // Contribution naming another trip's person.
    const contribution = { donorName: "D", amount: 5, method: "cash", receivedDate: "2027-01-01" };
    assert.equal(
      (
        await leader(`/api/trips/${tripA.id}/contributions`, {
          method: "POST",
          body: { ...contribution, participantId: personB.id },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await leader(`/api/trips/${tripA.id}/contributions`, {
          method: "POST",
          body: { ...contribution, participantId: personA.id },
        })
      ).status,
      201
    );

    // Document upload pointing at another trip's person and requirement.
    const upload = (fields) => {
      const form = new FormData();
      form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "x.pdf");
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return leader(`/api/trips/${tripA.id}/documents`, { method: "POST", body: form });
    };
    assert.equal((await upload({ participantId: personB.id, requirementId: requirementB.id })).status, 400);
    assert.equal((await upload({ participantId: personA.id, requirementId: requirementB.id })).status, 400);
    assert.equal(await prisma.tripDocument.count({ where: { tripId: tripB.id } }), 0);
    assert.equal((await upload({ participantId: personA.id })).status, 201);
  });
});

describe("the emailed sign-in link", () => {
  test("is sent once a minute per account, and only real accounts are audited", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        requirePasswordless: true,
        postmarkServerToken: encryptField("t"),
        emailFromAddress: "c@example.test",
      },
    });
    process.env.APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:4000";
    const { user, email } = await makeGuest("link");
    const known = () => anon("/api/auth/passwordless/email-link", { method: "POST", body: { email } });
    const unknownBefore = await prisma.auditLog.count({
      where: { action: "auth.sign_in_link_requested", targetEmail: "nobody-412@example.test" },
    });
    await anon("/api/auth/passwordless/email-link", {
      method: "POST",
      body: { email: "nobody-412@example.test" },
    });
    await pause(300);
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "auth.sign_in_link_requested", targetEmail: "nobody-412@example.test" },
      }),
      unknownBefore,
      "an unknown address leaves no audit row"
    );
    await known();
    await pause(400);
    const first = await prisma.signInLinkToken.findFirst({ where: { userId: user.id } });
    assert.ok(first, "the first request issues a link");
    await known();
    await known();
    await pause(400);
    const tokens = await prisma.signInLinkToken.findMany({ where: { userId: user.id } });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].id, first.id, "repeat requests don't replace the live link");
    // A minute later a new one may be issued.
    await prisma.signInLinkToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await known();
    await pause(400);
    assert.notEqual((await prisma.signInLinkToken.findFirst({ where: { userId: user.id } })).id, first.id);
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { requirePasswordless: false } });
  });
});

describe("a record's source file must be the same partner's", () => {
  test("a seat can't point a prayer request or need at another partner's file", async () => {
    const mine = await newPartner("mine");
    const theirs = await newPartner("theirs");
    const fileOf = async (partnerId) =>
      prisma.partnerFile.create({
        data: {
          partnerId,
          kind: "newsletter",
          title: "t",
          receivedDate: new Date("2027-01-01"),
          fileName: "f.pdf",
          contentType: "application/pdf",
        },
      });
    const myFile = await fileOf(mine.id);
    const theirFile = await fileOf(theirs.id);
    const { user, email } = await makeGuest("seat");
    await prisma.careTeamMember.create({ data: { partnerId: mine.id, userId: user.id } });
    const seat = as(cookieOf(await login(email)));
    const prayer = (sourceFileId) =>
      seat("/api/prayer-requests", {
        method: "POST",
        body: {
          partnerId: mine.id,
          category: "situational",
          requestText: "x",
          dateReceived: "2027-01-01",
          sourceFileId,
        },
      });
    assert.equal((await prayer(theirFile.id)).status, 400);
    assert.equal((await prayer(myFile.id)).status, 201);
    const need = (sourceFileId) =>
      seat("/api/support-needs", {
        method: "POST",
        body: {
          partnerId: mine.id,
          description: "x",
          requestedAmount: 5,
          requestDate: "2027-01-01",
          sourceFileId,
        },
      });
    assert.equal((await need(theirFile.id)).status, 400);
    assert.equal((await need(myFile.id)).status, 201);
  });
});

describe("who a contact is attributed to", () => {
  test("staff may log on someone's behalf; a care-team guest's entry is always their own", async () => {
    const partner = await newPartner("contact");
    const { user, email } = await makeGuest("contact");
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: user.id } });
    const editorUser = await prisma.user.findFirst({
      where: { role: "editor", email: { contains: "route-test" } },
    });
    const seat = as(cookieOf(await login(email)));
    const body = (contactedById) => ({
      partnerId: partner.id,
      contactType: "call",
      direction: "outbound",
      contactedById,
    });
    const byStaff = await editor("/api/contact-log", { method: "POST", body: body(user.id) });
    assert.equal(byStaff.status, 201, JSON.stringify(byStaff.body));
    assert.equal(byStaff.body.contactedBy.id, user.id, "staff attribute it to someone else");
    const bySeat = await seat("/api/contact-log", { method: "POST", body: body(editorUser.id) });
    assert.equal(bySeat.status, 201, JSON.stringify(bySeat.body));
    assert.equal(bySeat.body.contactedBy.id, user.id, "a guest can't");
  });
});

describe("passkey challenges and the relying party", () => {
  test("a challenge token is accepted once, through the database", async () => {
    const token = signChallenge({ challenge: "abc", purpose: "login", userId: "u1" });
    assert.equal(await consumeChallenge(token, { purpose: "login", userId: "u1" }), "abc");
    assert.equal(await consumeChallenge(token, { purpose: "login", userId: "u1" }), null, "spent");
    assert.ok(await prisma.spentPasskeyChallenge.findFirst(), "recorded in the table");
    assert.equal(
      await consumeChallenge(signChallenge({ challenge: "x", purpose: "register", userId: "u1" }), {
        purpose: "login",
        userId: "u1",
      }),
      null,
      "wrong purpose"
    );
  });

  test("production refuses to take the relying party from the request's Host header", () => {
    const saved = {
      env: process.env.NODE_ENV,
      base: process.env.APP_BASE_URL,
      render: process.env.RENDER_EXTERNAL_URL,
    };
    const req = { get: () => "evil.example.test", protocol: "https" };
    try {
      delete process.env.APP_BASE_URL;
      delete process.env.RENDER_EXTERNAL_URL;
      process.env.NODE_ENV = "production";
      assert.throws(() => relyingParty(req), /APP_BASE_URL/);
      process.env.NODE_ENV = "test";
      assert.equal(
        relyingParty(req).rpID,
        "evil.example.test",
        "outside production the host is trusted, as before"
      );
      process.env.NODE_ENV = "production";
      process.env.APP_BASE_URL = "https://church.example.test";
      assert.equal(relyingParty(req).rpID, "church.example.test");
    } finally {
      process.env.NODE_ENV = saved.env;
      if (saved.base === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = saved.base;
      if (saved.render !== undefined) process.env.RENDER_EXTERNAL_URL = saved.render;
    }
  });
});
