// Trip requirements: a document, a plain task, or an esignature, optionally with a due date
// and reminder lead time; fulfillment and cloning treat the kinds differently. Also covers the
// public self-service upload route (same token mechanism as meeting RSVP) and the notice sent
// to every existing participant when a document/esignature requirement is added to a trip that
// already has a team. The late-joiner catch-up tests live in tripParticipants.test.js: the
// endpoint under test there is tripParticipants.js's add/approve routes.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { loadRequirementItems, replaceRequirementItems } = require("../../src/utils/tripTemplates");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

// Same mock-the-whole-domain technique as publicSubscribe.test.js/dispatches.test.js for
// Postmark: patch global.fetch, matching only the Postmark host, so no real email ever sends
// in this suite.
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

// A requirement is a document or a plain task, optionally with a due date and a reminder lead
// time; fulfillment and cloning treat the two kinds differently.
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

// Public self-service document upload: same token mechanism as meeting RSVP/esignature, and
// the same shared multer config (backend/src/utils/upload.js) as the admin upload route.
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

  // The token is in the query string (like every other public trip-participant route) so it can
  // be verified before multer buffers the file; it is not a form field, so this helper only
  // builds the file part.
  function uploadForm(buffer, filename, mimeType) {
    const form = new FormData();
    form.set("file", new Blob([buffer], { type: mimeType }), filename);
    return form;
  }
  function uploadUrl(requirementId, token) {
    return `/api/public/trips/participants/upload/${requirementId}?token=${encodeURIComponent(token)}`;
  }

  test("a valid token uploads the file, and it fulfills the requirement", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);
    const pdf = Buffer.from("%PDF-1.4 test passport scan");

    const res = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(pdf, "passport.pdf", "application/pdf"),
    });
    assert.equal(res.status, 201);

    const doc = await prisma.tripDocument.findFirst({
      where: { requirementId: requirement.id, participantId: participant.id },
      include: { bytesRow: { select: { bytes: true } } },
    });
    assert.equal(doc.fileName, "passport.pdf");
    assert.equal(Buffer.from(doc.bytesRow.bytes).toString(), pdf.toString());

    const selfService = await anon(`/api/public/trips/participants/access?token=${token}`);
    const found = selfService.body.requirements.find((r) => r.id === requirement.id);
    assert.equal(found.fulfilled, true);
  });

  test("a missing/invalid token is rejected and nothing is stored", async () => {
    const { requirement } = await createTripWithParticipantAndRequirement();
    const res = await anon(uploadUrl(requirement.id, "not-a-real-token"), {
      method: "POST",
      body: uploadForm(Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
    });
    assert.equal(res.status, 401);
    const count = await prisma.tripDocument.count({ where: { requirementId: requirement.id } });
    assert.equal(count, 0);
  });

  test("a requirement that isn't kind 'document' is refused", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement("task");
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
    });
    assert.equal(res.status, 400);
  });

  test("a disallowed file type is rejected by the shared filter", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("just text"), "notes.txt", "text/plain"),
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

  // The route must verify the file's signature, not store req.file.mimetype as declared: a file
  // declared application/pdf but containing arbitrary bytes (multer's extension-based filter
  // only checks the declared Content-Type) would otherwise be accepted and served inline as PDF.
  test("a file declaring a real type but containing arbitrary bytes is rejected (#327 Finding 8)", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("not actually a pdf"), "fake.pdf", "application/pdf"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /doesn't match its declared type/);
    const count = await prisma.tripDocument.count({ where: { requirementId: requirement.id } });
    assert.equal(count, 0);
  });

  test("re-uploading via the same link replaces the prior file rather than duplicating it", async () => {
    const { participant, requirement } = await createTripWithParticipantAndRequirement();
    const token = buildTripParticipantAccessToken(participant);

    const first = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("%PDF-1.4 first"), "a.pdf", "application/pdf"),
    });
    assert.equal(first.status, 201);

    const second = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("%PDF-1.4 second"), "b.pdf", "application/pdf"),
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
    const res = await anon(uploadUrl(requirement.id, token), {
      method: "POST",
      body: uploadForm(Buffer.from("%PDF-1.4"), "x.pdf", "application/pdf"),
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

  // esignature-kind requirements are self-serve (the "Sign now" flow) like document-kind, so
  // they get the identical notice, not a second wording.
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

// A requirement can be scoped to only a trip's minor participants (e.g. a minor travel release
// form). Filtered at every read/reminder point, never by creating or withholding a
// TripRequirementStatus row (those are created lazily on first completion/upload).
describe("Trips: minors-only requirements (#278)", () => {
  const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

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

  // tripStartDate fixed well in the future so "minor"/"adult" is driven
  // entirely by dateOfBirth, not by whatever date the test happens to run.
  const TRIP_START = "2027-06-15";

  async function createTripWithRequirement(kind, overrides = {}) {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", startDate: TRIP_START, endDate: "2027-06-22" },
    });
    const requirement = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Minor Travel Release", kind, minorsOnly: true, ...overrides },
    });
    assert.equal(requirement.status, 201);
    assert.equal(requirement.body.minorsOnly, true, "minorsOnly must persist on creation");
    return { trip: trip.body, requirement: requirement.body };
  }

  function createParticipant(tripId, dateOfBirth) {
    return prisma.tripParticipant.create({
      data: {
        tripId,
        firstName: "Jamie",
        email: `minors-only-${Math.random().toString(36).slice(2)}@example.test`,
        dateOfBirth: new Date(dateOfBirth),
      },
    });
  }

  test("the self-service page excludes a minors-only requirement for an adult, includes it for a minor", async () => {
    const { trip, requirement } = await createTripWithRequirement("task");
    const adult = await createParticipant(trip.id, "1980-01-01");
    const minor = await createParticipant(trip.id, "2012-01-01");

    const adultToken = buildTripParticipantAccessToken(adult);
    const adultView = await anon(`/api/public/trips/participants/access?token=${adultToken}`);
    assert.equal(adultView.status, 200);
    assert.ok(
      !adultView.body.requirements.some((r) => r.id === requirement.id),
      "an adult must never see a minors-only requirement on their own list"
    );

    const minorToken = buildTripParticipantAccessToken(minor);
    const minorView = await anon(`/api/public/trips/participants/access?token=${minorToken}`);
    assert.equal(minorView.status, 200);
    assert.ok(minorView.body.requirements.some((r) => r.id === requirement.id));
  });

  test("the admin 'complete' endpoint rejects marking a minors-only task done for an adult participant", async () => {
    const { trip, requirement } = await createTripWithRequirement("task");
    const adult = await createParticipant(trip.id, "1980-01-01");

    const res = await admin(`/api/trips/requirements/${requirement.id}/participants/${adult.id}/complete`, {
      method: "PUT",
      body: { completed: true },
    });
    assert.equal(res.status, 400);
  });

  test("the admin 'complete' endpoint allows marking a minors-only task done for a minor participant", async () => {
    const { trip, requirement } = await createTripWithRequirement("task");
    const minor = await createParticipant(trip.id, "2012-01-01");

    const res = await admin(`/api/trips/requirements/${requirement.id}/participants/${minor.id}/complete`, {
      method: "PUT",
      body: { completed: true },
    });
    assert.equal(res.status, 200);
  });

  test("the public upload route refuses an adult uploading against a minors-only document requirement", async () => {
    const { trip, requirement } = await createTripWithRequirement("document");
    const adult = await createParticipant(trip.id, "1980-01-01");
    const token = buildTripParticipantAccessToken(adult);

    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4")], { type: "application/pdf" }), "x.pdf");
    const res = await anon(
      `/api/public/trips/participants/upload/${requirement.id}?token=${encodeURIComponent(token)}`,
      { method: "POST", body: form }
    );
    assert.equal(res.status, 404);
  });

  test("the public upload route allows a minor uploading against a minors-only document requirement", async () => {
    const { trip, requirement } = await createTripWithRequirement("document");
    const minor = await createParticipant(trip.id, "2012-01-01");
    const token = buildTripParticipantAccessToken(minor);

    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4")], { type: "application/pdf" }), "x.pdf");
    const res = await anon(
      `/api/public/trips/participants/upload/${requirement.id}?token=${encodeURIComponent(token)}`,
      { method: "POST", body: form }
    );
    assert.equal(res.status, 201);
  });

  test("the public sign route refuses an adult signing a minors-only esignature requirement", async () => {
    const { trip, requirement } = await createTripWithRequirement("esignature", { bodyText: "I agree..." });
    const adult = await createParticipant(trip.id, "1980-01-01");
    const token = buildTripParticipantAccessToken(adult);

    const res = await anon(`/api/public/trips/participants/sign/${requirement.id}`, {
      method: "POST",
      body: { token, signerName: "Parent Name" },
    });
    assert.equal(res.status, 404);
  });

  test("a minor's release is signed by a parent or guardian, and the page says the person is a minor", async () => {
    const { trip, requirement } = await createTripWithRequirement("esignature", { bodyText: "I agree..." });
    const minor = await createParticipant(trip.id, "2012-01-01");
    const token = buildTripParticipantAccessToken(minor);
    const view = await anon(`/api/public/trips/participants/access?token=${token}`);
    assert.equal(view.body.isMinor, true);

    const asSelf = await anon(`/api/public/trips/participants/sign/${requirement.id}`, {
      method: "POST",
      body: { token, signerName: "Jamie", signerRelationship: "self" },
    });
    assert.equal(asSelf.status, 400, "a minor cannot sign for themselves");
    const noneGiven = await anon(`/api/public/trips/participants/sign/${requirement.id}`, {
      method: "POST",
      body: { token, signerName: "Jamie" },
    });
    assert.equal(noneGiven.status, 400, "and leaving the relationship out is not a way round it");

    const asParent = await anon(`/api/public/trips/participants/sign/${requirement.id}`, {
      method: "POST",
      body: { token, signerName: "Pat Parent", signerRelationship: "parent/guardian" },
    });
    assert.equal(asParent.status, 201, JSON.stringify(asParent.body));
  });

  test("an adult can still sign a release for everyone as themselves", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", startDate: TRIP_START, endDate: "2027-06-22" },
    });
    const requirement = await admin(`/api/trips/${trip.body.id}/requirements`, {
      method: "POST",
      body: { label: "Release for everyone", kind: "esignature", bodyText: "I agree..." },
    });
    assert.equal(requirement.status, 201);
    const adult = await createParticipant(trip.body.id, "1980-01-01");
    const token = buildTripParticipantAccessToken(adult);
    const res = await anon(`/api/public/trips/participants/sign/${requirement.body.id}`, {
      method: "POST",
      body: { token, signerName: "Alex", signerRelationship: "self" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test("the due-date reminder scheduler never reminds an adult about a minors-only requirement", async () => {
    const { trip } = await createTripWithRequirement("document", {
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      reminderLeadDays: 5,
    });
    const adult = await createParticipant(trip.id, "1980-01-01");
    const minor = await createParticipant(trip.id, "2012-01-01");

    const { checkAndSendRequirementReminders } = require("../../src/utils/tripReminderScheduler");
    const sent = await captureEmails(async () => {
      await checkAndSendRequirementReminders();
    });

    assert.ok(
      !sent.some((m) => m.To === adult.email),
      "an adult must never get a reminder for a minors-only requirement"
    );
    assert.ok(
      sent.some((m) => m.To === minor.email),
      "a minor must still get the reminder"
    );
  });

  test("cloning a trip carries minorsOnly forward on its requirements", async () => {
    const { trip } = await createTripWithRequirement("task");
    const cloned = await admin(`/api/trips/${trip.id}/clone`, { method: "POST" });
    assert.equal(cloned.status, 201);
    assert.equal(cloned.body.requirements[0].minorsOnly, true);
  });

  test("the church-wide requirement template carries minorsOnly onto a newly-created trip", async () => {
    const original = await loadRequirementItems("template");
    try {
      await replaceRequirementItems(prisma, "template", [
        { id: "t1", label: "Minor Travel Release", kind: "task", minorsOnly: true },
      ]);
      const partner = await createPartner();
      const trip = await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, type: "Construction", status: "planning" },
      });
      assert.equal(trip.status, 201);
      assert.equal(trip.body.requirements[0].minorsOnly, true);
    } finally {
      await replaceRequirementItems(prisma, "template", original);
    }
  });
});
