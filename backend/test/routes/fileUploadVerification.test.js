// #327 Finding 8 -- utils/fileResponse.js serves a file inline only if its
// type is in VERIFIED_INLINE_TYPES, on the stated basis that those bytes
// were signature-checked at upload. Two of the three gaps the review
// found (the trip-document-requirement upload route is covered directly
// in tripRequirements.test.js, alongside its sibling tests) are covered
// here: partnerFiles.js's .eml handling, and the participant
// self-service photo route.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
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
  admin = await client("admin");
  anon = await client(null);
  await removeFixturePartners();

  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ trips: true });
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/partner-files -- .eml handling (#327 Finding 8)", () => {
  test("a .eml declaring a spoofed Content-Type is still stored as message/rfc822, not the declared type", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} upload-verification` },
    });
    assert.equal(partner.status, 201);

    const form = new FormData();
    // Real email bytes, but a spoofed Content-Type that IS in
    // VERIFIED_INLINE_TYPES -- before this fix, a .eml was exempt from
    // the signature check entirely and stored with whatever the client
    // declared.
    form.set(
      "file",
      new Blob([Buffer.from("From: sender@example.test\r\nSubject: Hi\r\n\r\nBody")], {
        type: "application/pdf",
      }),
      "update.eml"
    );
    form.set("partnerId", partner.body.id);
    form.set("receivedDate", "2027-01-01");
    form.set("kind", "email");

    const res = await admin("/api/partner-files", { method: "POST", body: form });
    assert.equal(res.status, 201);
    assert.equal(
      res.body.contentType,
      "message/rfc822",
      "must store the canonical type, never the declared one"
    );
  });

  test("a non-.eml file with a real signature mismatch is still rejected", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} upload-verification-2` },
    });
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("not actually a pdf")], { type: "application/pdf" }), "fake.pdf");
    form.set("partnerId", partner.body.id);
    form.set("receivedDate", "2027-01-01");
    form.set("kind", "office_document");

    const res = await admin("/api/partner-files", { method: "POST", body: form });
    assert.equal(res.status, 400);
  });
});

describe("PUT /api/public/trips/participants/self-service -- photo (#327 Finding 8)", () => {
  async function createParticipant() {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} self-service-photo` },
    });
    assert.equal(partner.status, 201, JSON.stringify(partner.body));
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.body.id, type: "Construction" },
    });
    assert.equal(trip.status, 201, JSON.stringify(trip.body));
    return prisma.tripParticipant.create({ data: { tripId: trip.body.id, firstName: "Sam" } });
  }

  test("a declared image/png whose bytes aren't actually a PNG is rejected", async () => {
    const participant = await createParticipant();
    const token = buildTripParticipantAccessToken(participant);
    const photo = `data:image/png;base64,${Buffer.from("not a real png").toString("base64")}`;

    const res = await anon("/api/public/trips/participants/self-service", {
      method: "PUT",
      body: { token, photo, photoContentType: "image/png" },
    });
    assert.equal(res.status, 400);

    const unchanged = await prisma.tripParticipant.findUnique({
      where: { id: participant.id },
      select: { photoContentType: true },
    });
    assert.equal(unchanged.photoContentType, null);
  });

  test("a real PNG is accepted", async () => {
    const participant = await createParticipant();
    const token = buildTripParticipantAccessToken(participant);
    // Minimal valid PNG signature (8 bytes) -- enough for matchesFileSignature,
    // this route never re-decodes it as a real image.
    const realPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const photo = `data:image/png;base64,${realPngBytes.toString("base64")}`;

    const res = await anon("/api/public/trips/participants/self-service", {
      method: "PUT",
      body: { token, photo, photoContentType: "image/png" },
    });
    assert.equal(res.status, 200);

    const updated = await prisma.tripParticipant.findUnique({
      where: { id: participant.id },
      select: { photoContentType: true },
    });
    assert.equal(updated.photoContentType, "image/png");
  });
});
