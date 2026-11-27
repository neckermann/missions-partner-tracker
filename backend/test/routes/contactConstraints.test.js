// The database refuses a phone or email that isn't in the saved form (the CHECK constraints at the end of the
// baseline migration), even when a script writes the column directly and skips the routes' checks.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { ensureTestUsers, removeTestUsers, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

let partner;
let adult;
let trip;

before(async () => {
  await ensureTestUsers();
  await removeFixturePartners();
  partner = await prisma.partner.create({
    data: { kind: "organization", displayName: `${FIXTURE_TAG} constraints` },
  });
  adult = await prisma.adult.create({ data: { partnerId: partner.id, firstName: "Pat" } });
  trip = await prisma.trip.create({
    data: { partnerId: partner.id, type: "Construction", status: "planning" },
  });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.$disconnect();
});

const refused = async (promise, what) =>
  assert.rejects(
    promise,
    (err) => /check constraint|_format|violat/i.test(`${err.message} ${err.code}`),
    what
  );

const PHONES = {
  Partner: ["contactPhone", "emergencyContactPhone", "contactViaPhone"],
  Adult: ["phone1", "phone2"],
  TripParticipant: ["phone", "emergencyContactPhone", "parentGuardianPhone"],
  TripApplication: ["phone", "emergencyContactPhone", "parentGuardianPhone"],
  TripContribution: ["donorPhone"],
  SendingParty: ["phone"],
  ChurchSettings: ["phone"],
  User: ["phone"],
};
const EMAILS = {
  Partner: ["contactEmail", "emergencyContactEmail", "contactViaEmail"],
  Adult: ["email"],
  TripParticipant: ["email", "emergencyContactEmail", "parentGuardianEmail"],
  TripApplication: ["email", "emergencyContactEmail", "parentGuardianEmail"],
  TripContribution: ["donorEmail"],
  SendingParty: ["contactEmail"],
  ChurchSettings: ["contactEmail"],
};

describe("phone and email constraints", () => {
  test("all of them exist, one per column, and the login and newsletter emails have none", async () => {
    const rows = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conname LIKE '%\\_format'`;
    const have = new Set(rows.map((r) => r.conname));
    const want = [];
    for (const group of [PHONES, EMAILS])
      for (const [t, cols] of Object.entries(group)) for (const c of cols) want.push(`${t}_${c}_format`);
    assert.equal(want.length, 28);
    for (const name of want) assert.ok(have.has(name), `${name} is missing`);
    assert.ok(!have.has("User_email_format"), "the login email is not constrained");
    assert.ok(!have.has("PublicSubscriber_email_format"), "newsletter signups are not constrained");
  });

  test("a partner's phones take only international digits; blank must be NULL", async () => {
    for (const col of PHONES.Partner) {
      for (const bad of [
        "555-0100",
        "(506) 555-0259",
        "5065550259",
        "+0123456789",
        "+1506",
        "+15065550259123456",
        "dsafdsfsadf",
        "",
        " +15065550259",
      ]) {
        await refused(
          prisma.partner.update({ where: { id: partner.id }, data: { [col]: bad } }),
          `${col}=${JSON.stringify(bad)}`
        );
      }
      for (const good of ["+15065550259", "+442079460958", "+4930123456", null]) {
        await prisma.partner.update({ where: { id: partner.id }, data: { [col]: good } });
      }
    }
  });

  test("the adults', trip's and church's phones are held to the same rule", async () => {
    await refused(prisma.adult.update({ where: { id: adult.id }, data: { phone1: "555-0100" } }));
    await refused(prisma.adult.update({ where: { id: adult.id }, data: { phone2: "" } }));
    await prisma.adult.update({ where: { id: adult.id }, data: { phone1: "+13375550100", phone2: null } });
    await refused(
      prisma.tripParticipant.create({ data: { tripId: trip.id, firstName: "A", lastName: "B", phone: "12" } })
    );
    const ok = await prisma.tripParticipant.create({
      data: {
        tripId: trip.id,
        firstName: "A",
        lastName: "B",
        phone: "+13375550101",
        parentGuardianPhone: "+13375550102",
      },
    });
    await refused(
      prisma.tripParticipant.update({ where: { id: ok.id }, data: { emergencyContactPhone: "call me" } })
    );
    await refused(
      prisma.tripContribution.create({
        data: {
          tripId: trip.id,
          donorName: "Friend",
          amount: 10,
          method: "cash",
          receivedDate: new Date(),
          donorPhone: "x",
        },
      })
    );
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { phone: true },
    });
    await refused(
      prisma.churchSettings.upsert({
        where: { id: "singleton" },
        update: { phone: "(309) 555-0100" },
        create: { id: "singleton", phone: "(309) 555-0100" },
      })
    );
    assert.equal(
      (await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { phone: true } }))
        ?.phone ?? null,
      settings?.phone ?? null,
      "a refused write changes nothing"
    );
  });

  test("an email must have the shape of an address and be at most 200 characters; case is not enforced", async () => {
    for (const col of EMAILS.Partner) {
      for (const bad of ["nope", "a@b", "a b@c.org", "@c.org", "a@@c.org", `${"x".repeat(200)}@c.org`, ""]) {
        await refused(
          prisma.partner.update({ where: { id: partner.id }, data: { [col]: bad } }),
          `${col}=${JSON.stringify(bad)}`
        );
      }
      for (const good of ["sam@example.org", "Sam.Doe@Example.ORG", `${"x".repeat(180)}@example.org`, null]) {
        await prisma.partner.update({ where: { id: partner.id }, data: { [col]: good } });
      }
    }
    await refused(prisma.adult.update({ where: { id: adult.id }, data: { email: "not an email" } }));
  });

  test("an application's own email is required and must be an address", async () => {
    const make = (email) =>
      prisma.tripApplication.create({
        data: {
          tripId: trip.id,
          firstName: "Pat",
          lastName: "Applicant",
          email,
          dateOfBirth: new Date("1990-01-01"),
        },
      });
    await refused(make("nope"));
    await refused(make(""));
    const row = await make("pat@example.test");
    await refused(prisma.tripApplication.update({ where: { id: row.id }, data: { phone: "555-0100" } }));
    await refused(prisma.tripApplication.update({ where: { id: row.id }, data: { email: "nope" } }));
    await prisma.tripApplication.update({
      where: { id: row.id },
      data: { phone: "+15065550259", emergencyContactEmail: null },
    });
  });
});
