// One rule for phone numbers and emails on every form that saves one (#548): refused in plain words
// when it isn't one, saved in a single form (a phone as +15065550259, an email in lower case),
// blank saved as nothing, and a field a request leaves out left alone.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
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
let anon;
let originalEnabledFeatures;

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

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ trips: true, publicTripDiscovery: true });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

const PHONE_PROBLEM = /doesn't look like a phone number/;
const EMAIL_PROBLEM = /doesn't look like an email address/;

describe("partners", () => {
  let org;

  test("a phone and an email are saved in one form, however they were typed", async () => {
    const made = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "organization",
        displayName: `${FIXTURE_TAG} fmt org`,
        contactPhone: "(506) 555-0259",
        contactEmail: "  Office@Example.TEST ",
        emergencyContactPhone: "506.555.0100",
        emergencyContactEmail: "Help@Example.test",
      },
    });
    assert.equal(made.status, 201);
    org = made.body;
    const row = await prisma.partner.findUnique({ where: { id: org.id } });
    assert.equal(row.contactPhone, "+15065550259");
    assert.equal(row.contactEmail, "office@example.test");
    assert.equal(row.emergencyContactPhone, "+15065550100");
    assert.equal(row.emergencyContactEmail, "help@example.test");
  });

  test("junk is refused and names the field; nothing is saved", async () => {
    const phone = await admin(`/api/partners/${org.id}`, {
      method: "PUT",
      body: { contactPhone: "dsafdsfsadf" },
    });
    assert.equal(phone.status, 400);
    assert.match(phone.body.error, /contactPhone: /);
    assert.match(phone.body.error, PHONE_PROBLEM);
    const email = await admin(`/api/partners/${org.id}`, {
      method: "PUT",
      body: { contactEmail: "not an email" },
    });
    assert.equal(email.status, 400);
    assert.match(email.body.error, EMAIL_PROBLEM);
    const short = await admin(`/api/partners/${org.id}`, {
      method: "PUT",
      body: { emergencyContactPhone: "555-0100" },
    });
    assert.equal(short.status, 400, "a number with no area code is not a number we can dial");
    const row = await prisma.partner.findUnique({ where: { id: org.id } });
    assert.equal(row.contactPhone, "+15065550259", "the good number is untouched");
    assert.equal(row.contactEmail, "office@example.test");
  });

  test("an update that leaves a number out keeps it; blank clears it", async () => {
    const renamed = await admin(`/api/partners/${org.id}`, {
      method: "PUT",
      body: { displayName: `${FIXTURE_TAG} fmt org renamed` },
    });
    assert.equal(renamed.status, 200);
    let row = await prisma.partner.findUnique({ where: { id: org.id } });
    assert.equal(row.contactPhone, "+15065550259", "omitted is not erased");
    assert.equal(row.contactEmail, "office@example.test");
    const cleared = await admin(`/api/partners/${org.id}`, {
      method: "PUT",
      body: { contactPhone: "  ", emergencyContactPhone: "" },
    });
    assert.equal(cleared.status, 200);
    row = await prisma.partner.findUnique({ where: { id: org.id } });
    assert.equal(row.contactPhone, null);
    assert.equal(row.emergencyContactPhone, null);
    assert.equal(row.contactEmail, "office@example.test", "only what was sent changed");
  });

  test("a family's adults take the same rule, and so does the go-between", async () => {
    const bad = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} fmt family bad`,
        adults: [{ firstName: "Pat", phone1: "12" }],
      },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, PHONE_PROBLEM);
    assert.equal(await prisma.partner.count({ where: { displayName: `${FIXTURE_TAG} fmt family bad` } }), 0);

    const ok = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} fmt family`,
        contactLevel: "no_direct",
        contactViaPhone: "+44 20 7946 0958",
        contactViaEmail: "Go.Between@Example.test",
        adults: [
          { firstName: "Pat", phone1: "(337) 555-0100", phone2: "337 555 0101", email: "PAT@Example.test" },
        ],
      },
    });
    assert.equal(ok.status, 201);
    const adult = await prisma.adult.findFirst({ where: { partnerId: ok.body.id } });
    assert.equal(adult.phone1, "+13375550100");
    assert.equal(adult.phone2, "+13375550101");
    assert.equal(adult.email, "pat@example.test");
    const row = await prisma.partner.findUnique({ where: { id: ok.body.id } });
    assert.equal(row.contactViaPhone, "+442079460958");
    assert.equal(row.contactViaEmail, "go.between@example.test");
  });

  test("the adult route takes the same rule", async () => {
    const partner = await prisma.partner.findFirst({ where: { displayName: `${FIXTURE_TAG} fmt family` } });
    const bad = await admin("/api/adults", {
      method: "POST",
      body: { partnerId: partner.id, firstName: "Sam", phone1: "call me" },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, PHONE_PROBLEM);
    const ok = await admin("/api/adults", {
      method: "POST",
      body: { partnerId: partner.id, firstName: "Sam", phone1: "(337) 555-0188", email: "SAM@example.test" },
    });
    assert.equal(ok.status, 201);
    const row = await prisma.adult.findUnique({ where: { id: ok.body.id } });
    assert.equal(row.phone1, "+13375550188");
    assert.equal(row.email, "sam@example.test");
    const edit = await admin(`/api/adults/${ok.body.id}`, { method: "PUT", body: { lastName: "Doe" } });
    assert.equal(edit.status, 200);
    assert.equal(
      (await prisma.adult.findUnique({ where: { id: ok.body.id } })).phone1,
      "+13375550188",
      "editing a name does not erase the number"
    );
  });
});

describe("a trip application", () => {
  async function acceptingTrip() {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} fmt applications` },
    });
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.body.id,
        type: "Construction",
        isPublic: true,
        status: "accepting_applications",
      },
    });
    return trip.body;
  }
  const application = (extra = {}) => ({
    firstName: "Pat",
    lastName: "Applicant",
    email: "pat-applicant@example.test",
    dateOfBirth: "1990-01-01",
    ...extra,
  });

  test("the applicant's phone and email are saved in one form", async () => {
    const trip = await acceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: application({
        email: "  Pat.Applicant@Example.TEST ",
        phone: "(506) 555-0259",
        emergencyContactPhone: "506-555-0100",
        emergencyContactEmail: "Mum@Example.test",
      }),
    });
    assert.equal(res.status, 201);
    const row = await prisma.tripApplication.findFirst({ where: { tripId: trip.id } });
    assert.equal(row.email, "pat.applicant@example.test");
    assert.equal(row.phone, "+15065550259");
    assert.equal(row.emergencyContactPhone, "+15065550100");
    assert.equal(row.emergencyContactEmail, "mum@example.test");
  });

  test("a phone that isn't one, or an email that isn't, is refused and nothing is stored", async () => {
    const trip = await acceptingTrip();
    for (const [extra, problem] of [
      [{ phone: "dsafdsfsadf" }, PHONE_PROBLEM],
      [{ phone: "555-0100" }, PHONE_PROBLEM],
      [{ emergencyContactPhone: "12" }, PHONE_PROBLEM],
      [{ emergencyContactEmail: "nope" }, EMAIL_PROBLEM],
      [{ email: "nope" }, EMAIL_PROBLEM],
      [{ email: "" }, EMAIL_PROBLEM],
    ]) {
      const res = await anon(`/api/public/trips/${trip.id}/apply`, {
        method: "POST",
        body: application(extra),
      });
      assert.equal(res.status, 400, JSON.stringify(extra));
      assert.match(res.body.error, problem, JSON.stringify(extra));
    }
    assert.equal(await prisma.tripApplication.count({ where: { tripId: trip.id } }), 0);
  });

  test("a phone and email are optional where they were optional", async () => {
    const trip = await acceptingTrip();
    const res = await anon(`/api/public/trips/${trip.id}/apply`, {
      method: "POST",
      body: application({ phone: "", emergencyContactPhone: null }),
    });
    assert.equal(res.status, 201);
    const row = await prisma.tripApplication.findFirst({ where: { tripId: trip.id } });
    assert.equal(row.phone, null);
    assert.equal(row.emergencyContactPhone, null);
  });
});
