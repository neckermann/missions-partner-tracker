// Trip participants/applications (#252) -- split out of trips.test.js
// to mirror #271's route split (routes/tripParticipants.js).
//
// This file deliberately holds every "late-joiner catch-up" test,
// regardless of whether the catch-up email is about an existing
// meeting, an existing requirement, or both -- not split further by
// that distinction. The reason: every one of these tests calls exactly
// one HTTP endpoint, either `POST /:id/participants` (direct add) or
// `PUT /applications/:id` (approve), both owned by
// routes/tripParticipants.js -- the meeting/requirement fixtures they
// need are created directly via Prisma, never through
// tripMeetings.js's or tripRequirements.js's own routers. So the
// router actually under test here is always tripParticipants.js; what
// varies is only which existing data its one side-effect function
// (sendLateJoinerCatchUpEmails, utils/tripEmails.js) has to catch up
// on. Splitting these tests by catch-up *content* instead of by
// *endpoint called* was tried first and abandoned -- it would have
// meant either duplicating the add/approve fixtures across multiple
// files for no benefit, or inventing an artificial boundary inside one
// side-effect function's own test coverage.
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

// A participant added after meetings already exist would otherwise
// never learn about them short of an admin remembering to click
// "Resend" on each one -- adding them should surface every meeting
// still ahead of them, and only those.
describe("Trips: adding a participant late catches up on existing meetings", () => {
  test("adding a participant late sends an invite for each future meeting, but not past or cancelled ones", async () => {
    const partner = await createPartner();
    // status must be explicit -- Trip.status defaults to "completed" when
    // omitted (a backfill-style create), under which neither the welcome
    // email nor a future-meeting invite is sent at all.
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    const past = await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const cancelledFuture = await prisma.tripMeeting.create({
      data: {
        tripId: trip.body.id,
        startAt: "2026-12-10T19:00:00.000Z",
        cancelledAt: new Date(),
      },
    });
    const future1 = await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-11T19:00:00.000Z", agenda: "Packing list" },
    });
    const future2 = await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-12T19:00:00.000Z", agenda: "Team send-off" },
    });

    let created;
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Late", lastName: "Joiner", email: "late-joiner@example.test" },
      });
      assert.equal(res.status, 201);
      created = res.body;
    });

    // The welcome email, plus exactly one invite per future, non-cancelled
    // meeting -- not the past one, not the cancelled one.
    const meetingInvites = sent.filter((m) => /^Meeting:/.test(m.Subject));
    assert.equal(meetingInvites.length, 2, "one invite per future, non-cancelled meeting");
    assert.ok(meetingInvites.every((m) => m.To === created.email));
    const bodies = meetingInvites.map((m) => m.TextBody).join("\n");
    assert.match(bodies, /Packing list/);
    assert.match(bodies, /Team send-off/);
    assert.ok(!bodies.includes(past.id), "no invite for the past meeting");
    assert.ok(!bodies.includes(cancelledFuture.id), "no invite for the cancelled future meeting");

    const welcome = sent.find((m) => /^You're on the team:/.test(m.Subject));
    assert.ok(welcome, "the existing one-time welcome email must still be sent");
  });

  test("adding a participant to a trip with no meetings behaves exactly as before", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Solo", lastName: "Joiner", email: "solo-joiner@example.test" },
      });
      assert.equal(res.status, 201);
    });

    assert.equal(sent.length, 1, "only the one-time welcome email, no meeting invites, no errors");
    assert.match(sent[0].Subject, /^You're on the team:/);
  });

  test("outboundEmail off suppresses both the welcome email and any future-meeting invites", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const partner = await createPartner();
      const trip = await admin("/api/trips", {
        method: "POST",
        body: { partnerId: partner.id, type: "Construction", status: "planning" },
      });
      await prisma.tripMeeting.create({
        data: { tripId: trip.body.id, startAt: "2026-12-15T19:00:00.000Z" },
      });

      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.body.id}/participants`, {
          method: "POST",
          body: { firstName: "Quiet", lastName: "Joiner", email: "quiet-joiner@example.test" },
        });
        assert.equal(res.status, 201);
      });
      assert.equal(sent.length, 0, "outboundEmail off must suppress every send, not just the welcome email");
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});

// The document/esignature-requirement counterpart to the late-joiner
// meeting-invite coverage above -- a participant added after a
// document-kind requirement already exists would otherwise never learn
// about it short of revisiting their own trip page unprompted. Also
// covers the identical catch-up triggered by approving an application
// (a separate code path, its own tx.tripParticipant.create in
// PUT /applications/:id, that previously got neither catch-up) --
// plausibly the more common real-world way someone becomes a
// participant at all.
describe("Trips: adding or approving a participant catches up on existing requirements and meetings", () => {
  test("adding a participant to a trip with an existing document requirement sends the checklist notice too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Late", lastName: "Joiner", email: "late-doc-joiner@example.test" },
      });
      assert.equal(res.status, 201);
    });

    const notice = sent.find((m) => /^New item needed: Passport photo page/.test(m.Subject));
    assert.ok(notice, "the existing document requirement must trigger a checklist notice");
    assert.equal(notice.To, "late-doc-joiner@example.test");
    assert.match(notice.TextBody, /\/my-trip\?token=/);
    const welcome = sent.find((m) => /^You're on the team:/.test(m.Subject));
    assert.ok(welcome, "the one-time welcome email must still be sent alongside it");
  });

  test("adding a participant to a trip with an existing esignature requirement sends the checklist notice too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Code of Conduct", kind: "esignature", bodyText: "I agree to..." },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Late", lastName: "Signer", email: "late-esign-joiner@example.test" },
      });
      assert.equal(res.status, 201);
    });

    const notice = sent.find((m) => /^New item needed: Code of Conduct/.test(m.Subject));
    assert.ok(notice, "the existing esignature requirement must trigger a checklist notice");
    assert.equal(notice.To, "late-esign-joiner@example.test");
    assert.match(notice.TextBody, /\/my-trip\?token=/);
  });

  test("outboundEmail off suppresses the late-joiner checklist notice for an esignature requirement too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "planning" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Code of Conduct", kind: "esignature", bodyText: "I agree to..." },
    });

    await setFeatures({ outboundEmail: false });
    try {
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.body.id}/participants`, {
          method: "POST",
          body: { firstName: "Quiet", lastName: "Signer", email: "quiet-esign-joiner@example.test" },
        });
        assert.equal(res.status, 201);
      });
      assert.equal(sent.length, 0, "outboundEmail off must suppress the esignature checklist notice too");
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  test("adding a participant to a trip with only a task-kind requirement sends no checklist notice", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "planning" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Attended orientation call", kind: "task" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Late", lastName: "Joiner2", email: "late-task-joiner@example.test" },
      });
      assert.equal(res.status, 201);
    });

    assert.ok(
      !sent.some((m) => /^New item needed:/.test(m.Subject)),
      "a task-kind requirement is not newly actionable and must not trigger a notice"
    );
  });

  test("adding a participant to a trip with no requirements at all behaves unchanged", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Solo", lastName: "Joiner2", email: "solo-doc-joiner@example.test" },
      });
      assert.equal(res.status, 201);
    });

    assert.equal(sent.length, 1, "only the one-time welcome email -- no requirements to notice about");
    assert.match(sent[0].Subject, /^You're on the team:/);
  });

  test("outboundEmail off suppresses the late-joiner checklist notice too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "planning" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });

    await setFeatures({ outboundEmail: false });
    try {
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.body.id}/participants`, {
          method: "POST",
          body: { firstName: "Quiet", lastName: "Joiner2", email: "quiet-doc-joiner@example.test" },
        });
        assert.equal(res.status, 201);
      });
      assert.equal(
        sent.length,
        0,
        "outboundEmail off must suppress the checklist notice, not just the welcome email"
      );
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  test("approving an application sends an invite for an existing future meeting too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "accepting_applications",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-11T19:00:00.000Z", agenda: "Packing list" },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Approved",
        lastName: "Applicant",
        email: "approved-applicant@example.test",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
    });

    const invite = sent.find((m) => /^Meeting:/.test(m.Subject));
    assert.ok(invite, "an existing future meeting must invite a newly-approved participant too");
    assert.equal(invite.To, "approved-applicant@example.test");
    assert.match(invite.TextBody, /Packing list/);
    const welcome = sent.find((m) => /^You're on the team:/.test(m.Subject));
    assert.ok(welcome, "the one-time welcome email must still be sent alongside it");
  });

  test("approving an application sends the checklist notice for an existing document requirement too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "accepting_applications" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Approved",
        lastName: "Applicant2",
        email: "approved-doc-applicant@example.test",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
    });

    const notice = sent.find((m) => /^New item needed: Passport photo page/.test(m.Subject));
    assert.ok(
      notice,
      "an existing document requirement must trigger a checklist notice for the approved applicant"
    );
    assert.equal(notice.To, "approved-doc-applicant@example.test");
  });

  test("approving an application sends the checklist notice for an existing esignature requirement too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "accepting_applications" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Code of Conduct", kind: "esignature", bodyText: "I agree to..." },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Approved",
        lastName: "Signer",
        email: "approved-esign-applicant@example.test",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
    });

    const notice = sent.find((m) => /^New item needed: Code of Conduct/.test(m.Subject));
    assert.ok(
      notice,
      "an existing esignature requirement must trigger a checklist notice for the approved applicant"
    );
    assert.equal(notice.To, "approved-esign-applicant@example.test");
  });

  test("approving an application into a trip with no meetings or requirements behaves unchanged", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "accepting_applications",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Approved",
        lastName: "Solo",
        email: "approved-solo-applicant@example.test",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
    });

    assert.equal(sent.length, 1, "only the one-time welcome email -- nothing to catch up on");
    assert.match(sent[0].Subject, /^You're on the team:/);
  });

  test("outboundEmail off suppresses both catch-up sends for an approved application too", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "accepting_applications" },
    });
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-11T19:00:00.000Z" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Quiet",
        lastName: "Applicant",
        email: "quiet-applicant@example.test",
      },
    });

    await setFeatures({ outboundEmail: false });
    try {
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/applications/${application.id}`, {
          method: "PUT",
          body: { status: "approved" },
        });
        assert.equal(res.status, 200);
      });
      assert.equal(sent.length, 0, "outboundEmail off must suppress every send, approval path included");
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  // Regression: unlike every other participant-facing email in this app
  // (meeting invites, requirement notices -- see utils/tripEmails.js's own
  // manualFallback()), this was the one place that silently dropped the
  // link entirely with outboundEmail off, rather than handing it back for
  // an admin to send manually -- a newly-approved participant had no way
  // to ever reach their own trip page until an admin happened to notice
  // and use "Resend access link" separately.
  test("outboundEmail off hands back a manual access link instead of silently dropping it", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "accepting_applications",
        startDate: "2026-12-20",
        endDate: "2026-12-27",
      },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "Quiet",
        lastName: "Applicant",
        email: "quiet-link-applicant@example.test",
      },
    });

    await setFeatures({ outboundEmail: false });
    try {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.teamWelcomeEmail?.sent, false);
      assert.match(res.body.teamWelcomeEmail?.manualUrl || "", /^https?:\/\//);
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  // Status alone can't distinguish "closed, still upcoming" from "closed,
  // entered after the fact as history" -- both share the same string.
  // sendLateJoinerCatchUpEmails also checks the trip's own dates, so a
  // closed-but-already-past trip is excluded the same as a "completed"
  // one, through either creation path.
  test("a participant added into a closed trip that's already in the past gets neither catch-up email", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "closed",
        startDate: "2020-01-01",
        endDate: "2020-01-08",
      },
    });
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-11T19:00:00.000Z" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "History", lastName: "Backfill", email: "history-backfill@example.test" },
      });
      assert.equal(res.status, 201);
    });

    // The welcome email's own gating only checks trip.status -- unchanged
    // by this directive, out of scope here -- so it still sends for a
    // "closed" trip regardless of dates. Only the catch-up sends
    // (meeting invite, checklist notice) are what this test is about.
    assert.ok(
      !sent.some((m) => /^Meeting:/.test(m.Subject) || /^New item needed:/.test(m.Subject)),
      "a closed-but-already-past trip is a historical record -- no catch-up emails either"
    );
  });

  test("approving an application into a closed trip that's already in the past gets neither catch-up email", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "closed",
        startDate: "2020-01-01",
        endDate: "2020-01-08",
      },
    });
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2026-12-11T19:00:00.000Z" },
    });
    await prisma.tripRequirement.create({
      data: { tripId: trip.body.id, label: "Passport photo page", kind: "document" },
    });
    const application = await prisma.tripApplication.create({
      data: {
        tripId: trip.body.id,
        firstName: "History",
        lastName: "Applicant",
        email: "history-applicant@example.test",
      },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/applications/${application.id}`, {
        method: "PUT",
        body: { status: "approved" },
      });
      assert.equal(res.status, 200);
    });

    // Same reasoning as the direct-add test above -- the welcome email's
    // own gating only checks status, so it still sends; only the catch-up
    // sends are what this test is about.
    assert.ok(
      !sent.some((m) => /^Meeting:/.test(m.Subject) || /^New item needed:/.test(m.Subject)),
      "a closed-but-already-past trip is a historical record -- no catch-up for an approved applicant either"
    );
  });
});
