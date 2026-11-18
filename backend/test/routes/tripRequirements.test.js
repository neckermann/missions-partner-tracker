// Trip requirements (#252) -- split out of trips.test.js to mirror
// #271's route split (routes/tripRequirements.js). A requirement is a
// document, a plain task, or an esignature, optionally with a due date
// and a reminder lead time; fulfillment and cloning each have to treat
// the kinds differently. Also covers the public self-service upload
// route (same token mechanism as meeting RSVP) and the notice sent to
// every existing participant when a new document/esignature
// requirement is added to a trip that already has a team.
//
// What's deliberately NOT here: the late-joiner catch-up tests for
// "adding/approving a participant into a trip that already has
// requirements" live in tripParticipants.test.js instead -- the
// endpoint under test there is tripParticipants.js's own add/approve
// routes, not this file's, even though the email body they trigger is
// about an existing requirement. See that file's own header comment
// for the full reasoning.
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

// Same mock-the-whole-domain technique publicSubscribe.test.js/
// dispatches.test.js already use for Postmark -- monkey-patch
// global.fetch, matching only the Postmark host, so no real email ever
// sends in this suite.
const realFetch = global.fetch;
global.fetch = (url, options) => {
  if (String(url).startsWith("https://api.postmarkapp.com")) {
    const body = { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z" };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  return realFetch(url, options);
};

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

async function setTripsSettings(patch) {
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: patch });
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
  await setFeatures({ trips: true, publicTripDiscovery: true, outboundEmail: true });
  await setTripsSettings({ allowPrivateApplicationLinks: true, allowPublicSupportRaisingLinks: true });
  await admin("/api/settings/email", {
    method: "PUT",
    body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.test" },
  });
});

after(async () => {
  global.fetch = realFetch;
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

async function createPartner(overrides = {}) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} trips`, ...overrides },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// TripRequirement generalization -- a requirement is a document or a
// plain task, optionally with a due date and a reminder lead time;
// fulfillment and cloning both have to treat the two kinds differently.
describe("Trips: requirements (document or task)", () => {
  test("rejects a reminder lead time with no due date", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "No due date set", reminderLeadDays: 3 },
    });
    assert.equal(res.status, 400);
  });

  test("a task requirement's fulfillment is per-participant, not shared across the whole trip", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const requirement = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Attended orientation call", kind: "task" },
    });
    assert.equal(requirement.status, 201);
    const alice = await prisma.tripParticipant.create({ data: { tripId: trip.body.id, firstName: "Alice" } });
    const bob = await prisma.tripParticipant.create({ data: { tripId: trip.body.id, firstName: "Bob" } });

    const completed = await admin(
      `/api/trips/requirements/${requirement.body.id}/participants/${alice.id}/complete`,
      {
        method: "PUT",
        body: { completed: true },
      }
    );
    assert.equal(completed.status, 200);

    const fetched = await admin(`/api/trips/${trip.body.id}`);
    const fetchedReq = fetched.body.requirements.find((r) => r.id === requirement.body.id);
    assert.ok(
      fetchedReq.requirementStatuses.find((s) => s.participantId === alice.id)?.completedAt,
      "Alice's own status should be completed"
    );
    assert.ok(
      !fetchedReq.requirementStatuses.find((s) => s.participantId === bob.id),
      "Bob must have no status row at all -- never marked complete on his behalf"
    );
  });

  test("a document requirement cannot be marked complete directly -- only fulfilled by uploading its document", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const requirement = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Signed Waiver", kind: "document" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie" },
    });
    const res = await admin(
      `/api/trips/requirements/${requirement.body.id}/participants/${participant.id}/complete`,
      {
        method: "PUT",
        body: { completed: true },
      }
    );
    assert.equal(res.status, 400);
  });

  test("cloning copies label/kind/reminderLeadDays but never the due date forward", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Passport copy", dueAt: "2026-11-25", reminderLeadDays: 5 },
    });

    const cloned = await admin(`/api/trips/${trip.body.id}/clone`, { method: "POST" });
    assert.equal(cloned.status, 201);
    const clonedReq = cloned.body.requirements[0];
    assert.equal(clonedReq.label, "Passport copy");
    assert.equal(clonedReq.kind, "document");
    assert.equal(clonedReq.reminderLeadDays, 5);
    assert.equal(
      clonedReq.dueAt,
      null,
      "a specific calendar date from the prior run must never copy forward"
    );
  });

  test("the self-service page reports every requirement's fulfillment state, both kinds", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Signed Waiver", kind: "document" },
    });
    const taskReq = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Attended orientation call", kind: "task" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie" },
    });
    await admin(`/api/trips/requirements/${taskReq.body.id}/participants/${participant.id}/complete`, {
      method: "PUT",
      body: { completed: true },
    });

    const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
    const accessToken = buildTripParticipantAccessToken({ id: participant.id, accessTokenVersion: 0 });
    const selfService = await anon(`/api/public/trips/participants/access?token=${accessToken}`);
    assert.equal(selfService.status, 200);
    const byLabel = Object.fromEntries(selfService.body.requirements.map((r) => [r.label, r.fulfilled]));
    assert.equal(byLabel["Signed Waiver"], false);
    assert.equal(byLabel["Attended orientation call"], true);
  });
});

// Public self-service document upload (requirement self-serve round) --
// same token mechanism as meeting RSVP/esignature, and the same shared
// multer config (backend/src/utils/upload.js) the admin upload route
// now also uses.
describe("Trips: public document-requirement upload", () => {
  const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

  async function createTripWithParticipantAndRequirement(kind = "document") {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Casey", email: "casey-upload@example.test" },
    });
    const requirement = await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind },
    });
    return { trip: trip.body, participant, requirement };
  }

  function uploadForm(token, buffer, filename, mimeType) {
    const form = new FormData();
    form.set("token", token);
    form.set("file", new Blob([buffer], { type: mimeType }), filename);
    return form;
  }

  test("a valid token uploads the file, and it fulfills the requirement", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);
    const pdf = Buffer.from("%PDF-1.4 test passport scan");

    const res = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, pdf, "passport.pdf", "application/pdf"),
    });
    assert.equal(res.status, 201);

    const doc = await prisma.tripDocument.findFirst({
      where: { requirementId: requirement.id, participantId: participant.id },
    });
    assert.equal(doc.fileName, "passport.pdf");
    assert.equal(Buffer.from(doc.bytes).toString(), pdf.toString());

    const selfService = await anon(`/api/public/trips/participants/access?token=${token}`);
    const found = selfService.body.requirements.find((r) => r.id === requirement.id);
    assert.equal(found.fulfilled, true);
  });

  test("a missing/invalid token is rejected and nothing is stored", async () => {
    const { requirement } = await createTripWithParticipantAndRequirement();
    const res = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm("not-a-real-token", Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
    });
    assert.equal(res.status, 401);
    const count = await prisma.tripDocument.count({ where: { requirementId: requirement.id } });
    assert.equal(count, 0);
  });

  test("a requirement that isn't kind 'document' is refused", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement("task");
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
    });
    assert.equal(res.status, 400);
  });

  test("a disallowed file type is rejected by the shared filter", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, Buffer.from("just text"), "notes.txt", "text/plain"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /JPG, PNG, WEBP, or PDF/);
  });

  test("the admin upload route now rejects the same disallowed file type (shared filter applies to both)", async () => {
    const { trip, participant, requirement } = await createTripWithParticipantAndRequirement();
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("just text")], { type: "text/plain" }), "notes.txt");
    form.set("participantId", participant.id);
    form.set("requirementId", requirement.id);
    const res = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
    assert.equal(res.status, 400);
  });

  test("re-uploading via the same link replaces the prior file rather than duplicating it", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);

    const first = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, Buffer.from("%PDF-1.4 first"), "a.pdf", "application/pdf"),
    });
    assert.equal(first.status, 201);

    const second = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, Buffer.from("%PDF-1.4 second"), "b.pdf", "application/pdf"),
    });
    assert.equal(second.status, 201);

    const docs = await prisma.tripDocument.findMany({
      where: { requirementId: requirement.id, participantId: participant.id },
    });
    assert.equal(docs.length, 1, "one row per (requirement, participant), not one per upload");
    assert.equal(docs[0].fileName, "b.pdf");
  });

  test("admin re-uploading for the same requirement+participant also replaces, not duplicates", async () => {
    const { trip, participant, requirement } = await createTripWithParticipantAndRequirement();
    for (const name of ["first.pdf", "second.pdf"]) {
      const form = new FormData();
      form.set("file", new Blob([Buffer.from("%PDF-1.4")], { type: "application/pdf" }), name);
      form.set("participantId", participant.id);
      form.set("requirementId", requirement.id);
      const res = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
      assert.equal(res.status, 201);
    }
    const docs = await prisma.tripDocument.findMany({
      where: { requirementId: requirement.id, participantId: participant.id },
    });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].fileName, "second.pdf");
  });

  test("a token for a different participant's trip is refused", async () => {
    const { requirement } = await createTripWithParticipantAndRequirement();
    const { participant: otherParticipant } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(otherParticipant);
    const res = await anon(`/api/public/trips/participants/upload/${requirement.id}`, {
      method: "POST",
      body: uploadForm(token, Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
    });
    assert.equal(res.status, 404);
  });
});

// Creating a document/esignature requirement on a trip that already has
// a team notifies every current participant -- otherwise it would sit
// invisible until someone happened to revisit their own trip page.
describe("Trips: creating a requirement notifies existing participants", () => {
  async function captureEmails(run) {
    const captured = [];
    const prevFetch = global.fetch;
    global.fetch = (url, options) => {
      if (String(url).startsWith("https://api.postmarkapp.com") && options?.body) {
        try {
          captured.push(JSON.parse(options.body));
        } catch {
          /* non-JSON body -- not a send this test cares about */
        }
      }
      return prevFetch(url, options);
    };
    try {
      await run();
    } finally {
      global.fetch = prevFetch;
    }
    return captured;
  }

  test("creating a document-kind requirement emails every current participant a link to their own trip page", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jordan", email: "jordan-reqmail@example.test" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
        method: "POST",
        body: { label: "Passport photo page", kind: "document" },
      });
      assert.equal(res.status, 201);
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].Subject, /New item needed: Passport photo page/);
    assert.match(sent[0].TextBody, /\/my-trip\?token=/);
  });

  test("creating a task-kind requirement sends no email (only document-kind is newly actionable)", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Morgan", email: "morgan-reqmail@example.test" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
        method: "POST",
        body: { label: "Attended orientation call", kind: "task" },
      });
      assert.equal(res.status, 201);
    });
    assert.equal(sent.length, 0);
  });

  test("creating a document-kind requirement sends no email when outboundEmail is off", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const partner = await createPartner();
      const trip = await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, type: "Construction" },
      });
      await prisma.tripParticipant.create({
        data: { tripId: trip.body.id, firstName: "Riley", email: "riley-reqmail@example.test" },
      });
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
          method: "POST",
          body: { label: "Passport photo page", kind: "document" },
        });
        assert.equal(res.status, 201);
      });
      assert.equal(sent.length, 0);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  // esignature-kind requirements are self-serve (the existing "Sign now"
  // flow) the same way document-kind is -- they get the identical notice,
  // not a second wording, since the email's "checklist item" phrasing was
  // already kind-neutral.
  test("creating an esignature-kind requirement emails every current participant a link to their own trip page", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Avery", email: "avery-reqmail@example.test" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
        method: "POST",
        body: { label: "Code of Conduct", kind: "esignature", bodyText: "I agree to..." },
      });
      assert.equal(res.status, 201);
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].Subject, /New item needed: Code of Conduct/);
    assert.match(sent[0].TextBody, /\/my-trip\?token=/);
  });

  test("creating an esignature-kind requirement sends no email when outboundEmail is off", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const partner = await createPartner();
      const trip = await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, type: "Construction" },
      });
      await prisma.tripParticipant.create({
        data: { tripId: trip.body.id, firstName: "Quinn", email: "quinn-reqmail@example.test" },
      });
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.body.id}/requirements`, {
          method: "POST",
          body: { label: "Code of Conduct", kind: "esignature", bodyText: "I agree to..." },
        });
        assert.equal(res.status, 201);
      });
      assert.equal(sent.length, 0);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});
