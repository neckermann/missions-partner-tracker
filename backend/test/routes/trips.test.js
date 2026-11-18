// Trips (#252) -- focused coverage of the parts most likely to be gotten
// wrong by generic instinct: the feature-gate split between `trips` and
// `publicTripDiscovery`, the restricted-partner mask-vs-exclude split
// across public surfaces, and the lost-link recovery route's
// enumeration-prevention guarantee. Ordinary CRUD is already covered by
// collections.test.js/errors.test.js's shared parameterized cases.
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

describe("Trips: feature gate", () => {
  test("publicTripDiscovery off 404s discovery and the plain application route, even with trips on and the trip isPublic", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, status: "accepting_applications", isPublic: true, type: "Construction" },
    });
    assert.equal(trip.status, 201);

    await setFeatures({ publicTripDiscovery: false });
    const list = await anon("/api/public/trips");
    assert.equal(list.status, 404);
    const plain = await anon(`/api/public/trips/${trip.body.id}`);
    assert.equal(plain.status, 404);
    await setFeatures({ publicTripDiscovery: true });

    const listOn = await anon("/api/public/trips");
    assert.equal(listOn.status, 200);
    assert.ok(listOn.body.some((t) => t.id === trip.body.id));
  });

  test("trips off 404s the backend router entirely", async () => {
    await setFeatures({ trips: false });
    const res = await admin("/api/trips");
    assert.equal(res.status, 404);
    await setFeatures({ trips: true });
  });
});

describe("Trips: restricted-partner handling -- three different rules, not one", () => {
  test("excluded from discovery and the plain application route; masked (not excluded) on the private-link application route and the support-raising page; unmasked on the self-service page", async () => {
    const partner = await createPartner({ isRestricted: true });
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        status: "accepting_applications",
        isPublic: true, // deliberately true -- restricted must override this
        type: "Construction",
        name: "Secret Destination Trip",
      },
    });
    assert.equal(trip.status, 201);

    // Discovery: excluded outright.
    const list = await anon("/api/public/trips");
    assert.ok(
      !list.body.some((t) => t.id === trip.body.id),
      "restricted trip must never appear in discovery"
    );

    // Plain application route: excluded outright (404, not masked).
    const plain = await anon(`/api/public/trips/${trip.body.id}`);
    assert.equal(plain.status, 404);

    // Private application link: masked, not excluded -- still works.
    const generated = await admin(`/api/trips/${trip.body.id}/generate-application-link`, { method: "POST" });
    assert.equal(generated.status, 200);
    const token = generated.body.applicationShareToken;

    const viaToken = await anon(`/api/public/trips/by-token/${token}`);
    assert.equal(viaToken.status, 200);
    assert.equal(viaToken.body.isRestricted, true);
    assert.notEqual(
      viaToken.body.fieldDisplayName,
      partner.displayName,
      "masked view must not show the real partner name"
    );

    // Support-raising page: masked, not excluded.
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie", shareToken: "test-share-token-restricted" },
    });
    const supportRaising = await anon(`/api/public/trips/participants/by-token/${participant.shareToken}`);
    assert.equal(supportRaising.status, 200);
    assert.notEqual(supportRaising.body.trip.fieldDisplayName, partner.displayName);

    // Self-service: real, unmasked data.
    const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
    const accessToken = buildTripParticipantAccessToken({ id: participant.id, accessTokenVersion: 0 });
    const selfService = await anon(`/api/public/trips/participants/access?token=${accessToken}`);
    assert.equal(selfService.status, 200);
    assert.equal(selfService.body.trip.fieldDisplayName, partner.fieldDisplayName || partner.displayName);
  });
});

describe("Trips: lost-link recovery enumeration prevention", () => {
  test("response is identical whether or not the email matches anything", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Known", email: "known-participant@example.test" },
    });

    const matched = await anon("/api/public/trips/participants/request-access-link", {
      method: "POST",
      body: { email: "known-participant@example.test" },
    });
    const unmatched = await anon("/api/public/trips/participants/request-access-link", {
      method: "POST",
      body: { email: "nobody-like-this@example.test" },
    });
    assert.equal(matched.status, unmatched.status);
    assert.deepEqual(matched.body, unmatched.body, "response body must not reveal whether the email matched");
  });
});

// TripRequirement generalization (follow-on round after the above) --
// a requirement is a document or a plain task, optionally with a due
// date and a reminder lead time; fulfillment and cloning both have to
// treat the two kinds differently.
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

// Meetings uplift -- agenda/meetingLink as real fields (not a free-text
// "notes" column nothing ever surfaced), an explicit resend, and a
// soft-cancel that notifies instead of silently vanishing.
describe("Trips: meetings", () => {
  // Wraps a block of calls, capturing every Postmark send attempted
  // during it -- same local-override-then-restore idiom
  // emailDispatchDelivery.test.js already uses for this, scoped to one
  // test at a time rather than a whole-file capture.
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

  async function createTripWithParticipant() {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie", email: "jamie-meetings@example.test" },
    });
    return { trip: trip.body, participant };
  }

  test("creating a meeting sends an invite whose body includes the agenda and join link", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: {
          startAt: "2026-12-01T19:00:00.000Z",
          location: "Church fellowship hall",
          meetingLink: "https://zoom.us/j/111",
          agenda: "Review packing list",
        },
      });
      assert.equal(res.status, 201);
      meeting = res.body;
    });
    assert.equal(meeting.agenda, "Review packing list");
    assert.equal(meeting.meetingLink, "https://zoom.us/j/111");
    assert.equal(sent.length, 1);
    assert.match(sent[0].Subject, /^Meeting:/);
    assert.match(sent[0].TextBody, /Review packing list/);
    assert.match(sent[0].TextBody, /https:\/\/zoom\.us\/j\/111/);
  });

  test("a meeting's own title drives the email subject and the .ics SUMMARY, not just the trip name", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-03T19:00:00.000Z", title: "Pre-Field Training" },
      });
      assert.equal(res.status, 201);
      meeting = res.body;
    });
    assert.equal(meeting.title, "Pre-Field Training");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].Subject, "Meeting: Pre-Field Training");
    const ics = sent[0].Attachments?.find((a) => a.Name === "meeting.ics");
    const decoded = Buffer.from(ics.Content, "base64").toString();
    assert.match(decoded, /SUMMARY:Pre-Field Training/);
  });

  test("a meeting with no title falls back to exactly today's trip-name-only subject", async () => {
    const { trip } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-04T19:00:00.000Z" },
      });
      assert.equal(res.status, 201);
    });
    assert.equal(sent.length, 1);
    // trip.name is unset in createTripWithParticipant -- falls through to
    // trip.type ("Construction"), same as before this field existed.
    assert.equal(sent[0].Subject, "Meeting: Construction");
    const ics = sent[0].Attachments?.find((a) => a.Name === "meeting.ics");
    const decoded = Buffer.from(ics.Content, "base64").toString();
    assert.match(decoded, /SUMMARY:Construction/);
  });

  test("cancelling a titled meeting carries the title into the cancellation subject too", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-05T19:00:00.000Z", title: "Team Orientation Call" },
      });
      meeting = res.body;
    });
    const sent = await captureEmails(async () => {
      await admin(`/api/trips/meetings/${meeting.id}/cancel`, { method: "POST" });
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].Subject, "Meeting cancelled: Team Orientation Call");
  });

  test("an agenda-only edit updates silently; a meetingLink change resends the invite", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-02T19:00:00.000Z", location: "Church fellowship hall" },
      });
      meeting = res.body;
    });

    const agendaOnly = await captureEmails(async () => {
      const res = await admin(`/api/trips/meetings/${meeting.id}`, {
        method: "PUT",
        body: { agenda: "Updated agenda text" },
      });
      assert.equal(res.status, 200);
    });
    assert.equal(agendaOnly.length, 0, "an agenda-only edit must not resend anything");

    const linkChanged = await captureEmails(async () => {
      const res = await admin(`/api/trips/meetings/${meeting.id}`, {
        method: "PUT",
        body: { meetingLink: "https://zoom.us/j/222" },
      });
      assert.equal(res.status, 200);
    });
    assert.equal(linkChanged.length, 1, "a meetingLink change must trigger a resend");
    assert.match(linkChanged[0].TextBody, /https:\/\/zoom\.us\/j\/222/);
  });

  test("explicit resend sends again with no change, and is refused once the meeting is cancelled", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-03T19:00:00.000Z" },
      });
      meeting = res.body;
    });

    const resent = await captureEmails(async () => {
      const res = await admin(`/api/trips/meetings/${meeting.id}/resend`, { method: "POST" });
      assert.equal(res.status, 200);
    });
    assert.equal(resent.length, 1);

    await admin(`/api/trips/meetings/${meeting.id}/cancel`, { method: "POST" });
    const afterCancel = await admin(`/api/trips/meetings/${meeting.id}/resend`, { method: "POST" });
    assert.equal(afterCancel.status, 400);
  });

  test("cancelling sends a cancellation notice, hides the meeting from self-service, and blocks delete/edit", async () => {
    const { trip, participant } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-04T19:00:00.000Z", location: "Church fellowship hall" },
      });
      meeting = res.body;
    });

    const cancelSent = await captureEmails(async () => {
      const res = await admin(`/api/trips/meetings/${meeting.id}/cancel`, { method: "POST" });
      assert.equal(res.status, 200);
      assert.ok(res.body.cancelledAt);
    });
    assert.equal(cancelSent.length, 1);
    assert.match(cancelSent[0].Subject, /^Meeting cancelled:/);

    const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
    const accessToken = buildTripParticipantAccessToken({ id: participant.id, accessTokenVersion: 0 });
    const selfService = await anon(`/api/public/trips/participants/access?token=${accessToken}`);
    assert.equal(selfService.status, 200);
    assert.ok(
      !selfService.body.meetings.some((m) => m.id === meeting.id),
      "a cancelled meeting must not appear in the participant's own itinerary"
    );

    const editAttempt = await admin(`/api/trips/meetings/${meeting.id}`, {
      method: "PUT",
      body: { agenda: "too late" },
    });
    assert.equal(editAttempt.status, 400);

    const deleteAttempt = await admin(`/api/trips/meetings/${meeting.id}`, { method: "DELETE" });
    assert.equal(deleteAttempt.status, 400);
  });

  test("delete is allowed for a meeting that was never cancelled -- correcting a data-entry mistake", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-05T19:00:00.000Z" },
      });
      meeting = res.body;
    });
    const res = await admin(`/api/trips/meetings/${meeting.id}`, { method: "DELETE" });
    assert.equal(res.status, 204);
  });

  test("the day-before reminder scheduler skips a cancelled meeting", async () => {
    const { trip } = await createTripWithParticipant();
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // inside the 23-25h window
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt, cancelledAt: new Date() },
    });

    const { checkAndSendTripMeetingReminders } = require("../../src/utils/tripReminderScheduler");
    const sent = await captureEmails(async () => {
      await checkAndSendTripMeetingReminders();
    });
    assert.equal(sent.length, 0, "a cancelled meeting must never get a day-before reminder");

    const reloaded = await prisma.tripMeeting.findUnique({ where: { id: meeting.id } });
    assert.equal(reloaded.reminderSentAt, null);
  });

  // A participant added after meetings already exist would otherwise
  // never learn about them short of an admin remembering to click
  // "Resend" on each one -- adding them should surface every meeting
  // still ahead of them, and only those.
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

// A different gap than the late-joiner suite above: an EXISTING
// participant, not a new one. Every participant's welcome email attaches
// the trip-dates .ics at the moment they join -- but nothing used to
// resend it if an admin later changed startDate/endDate, so an existing
// participant's calendar kept showing the old, now-wrong dates.
describe("Trips: reschedule resends trip dates", () => {
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

  async function createTripWithParticipant(fields = {}) {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-01",
        endDate: "2026-12-08",
        ...fields,
      },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Jamie", email: "jamie-reschedule@example.test" },
    });
    return { trip: trip.body, participant };
  }

  test("changing startDate resends the updated trip-dates invite to every current participant", async () => {
    const { trip } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { startDate: "2026-12-03" } });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].Subject, /^Trip dates updated:/);
    assert.equal(sent[0].To, "jamie-reschedule@example.test");
    const ics = sent[0].Attachments?.find((a) => a.Name === "trip-dates.ics");
    assert.ok(ics, "the updated-dates email must attach a new .ics");
    const decoded = Buffer.from(ics.Content, "base64").toString();
    assert.match(
      decoded,
      /DTSTART;VALUE=DATE:20261203/,
      "the attached .ics must reflect the NEW date, not the old one"
    );
  });

  test("changing endDate resends too", async () => {
    const { trip } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { endDate: "2026-12-10" } });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].Subject, /^Trip dates updated:/);
  });

  test("changing an unrelated field sends nothing", async () => {
    const { trip } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, {
        method: "PUT",
        body: { description: "Updated description", teamSizeMax: 12 },
      });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 0, "an edit that doesn't touch startDate/endDate must not resend anything");
  });

  test("setting a date to the value it already has sends nothing", async () => {
    const { trip } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { startDate: "2026-12-01" } });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 0, "an unchanged date value must not count as a reschedule");
  });

  test("a trip with no participants behaves unchanged", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
        startDate: "2026-12-01",
        endDate: "2026-12-08",
      },
    });
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}`, {
        method: "PUT",
        body: { startDate: "2026-12-05" },
      });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 0, "no participants means no error and nothing sent");
  });

  test("a completed trip's reschedule skips the resend", async () => {
    const { trip } = await createTripWithParticipant({ status: "completed" });
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { startDate: "2026-12-03" } });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 0, "a completed trip must not resend a dates update");
  });

  test("a closed trip already in the past skips the resend", async () => {
    const { trip } = await createTripWithParticipant({
      status: "closed",
      startDate: "2020-01-01",
      endDate: "2020-01-08",
    });
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { endDate: "2020-01-10" } });
      assert.equal(res.status, 200);
    });
    assert.equal(
      sent.length,
      0,
      "a closed-and-already-past trip is historical -- no resend even though endDate changed"
    );
  });

  test("outboundEmail off suppresses the resend", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const { trip } = await createTripWithParticipant();
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.id}`, {
          method: "PUT",
          body: { startDate: "2026-12-05" },
        });
        assert.equal(res.status, 200);
      });
      assert.equal(sent.length, 0, "outboundEmail off must suppress the dates-update resend too");
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });
});

// One-click RSVP (issue #267's design decision) -- link-based only, no
// inbound email. Each link is a plain GET, verified by the exact same
// signed access token the self-service page already uses, so this
// suite leans on buildTripParticipantAccessToken directly rather than
// a parallel token mechanism.
describe("Trips: meeting RSVP", () => {
  const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

  // Same capture idiom as the "Trips: meetings" describe block above,
  // duplicated locally rather than hoisted to file scope -- each
  // describe block's own helper, same precedent emailDispatchDelivery.
  // test.js already follows for this.
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

  async function createTripWithParticipant() {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Taylor", email: "taylor-rsvp@example.test" },
    });
    return { trip: trip.body, participant };
  }

  test("the invite email includes all three RSVP links, each carrying the participant's own token", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-09T19:00:00.000Z", location: "Church fellowship hall" },
      });
      assert.equal(res.status, 201);
    });
    assert.equal(sent.length, 1);
    const body = sent[0].TextBody;
    assert.match(body, /\/meetings\/.+\/rsvp\?token=.+&response=yes/);
    assert.match(body, /\/meetings\/.+\/rsvp\?token=.+&response=no/);
    assert.match(body, /\/meetings\/.+\/rsvp\?token=.+&response=maybe/);

    // The token in the email must actually work -- not just look right.
    const yesLink = body.match(/(https?:\/\/\S*\/rsvp\?token=\S*&response=yes)/)[1];
    const res = await anon(yesLink.replace(/^https?:\/\/[^/]*/, ""));
    assert.equal(res.status, 200);
    const rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: {
        meetingId_participantId: {
          meetingId: (await prisma.tripMeeting.findFirstOrThrow({ where: { tripId: trip.id } })).id,
          participantId: participant.id,
        },
      },
    });
    assert.equal(rsvp.response, "yes");
  });

  test("a cancelled meeting's cancellation email carries no RSVP links", async () => {
    const { trip } = await createTripWithParticipant();
    let meeting;
    await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.id}/meetings`, {
        method: "POST",
        body: { startAt: "2026-12-16T19:00:00.000Z" },
      });
      meeting = res.body;
    });
    const sent = await captureEmails(async () => {
      await admin(`/api/trips/meetings/${meeting.id}/cancel`, { method: "POST" });
    });
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].TextBody, /\/rsvp\?/);
  });

  test("a valid token+response records it and overwrites on a later, different click", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-10T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);

    const yesRes = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`);
    assert.equal(yesRes.status, 200);
    assert.match(yesRes.body, /attending/);
    let rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp.response, "yes");

    const noRes = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=no`);
    assert.equal(noRes.status, 200);
    rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp.response, "no", "a later, different click must overwrite the earlier response");

    const count = await prisma.tripMeetingRsvp.count({ where: { meetingId: meeting.id } });
    assert.equal(count, 1, "one row per (meeting, participant), not one per click");
  });

  test("a tampered/invalid token is rejected and records nothing", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-11T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);
    const tampered = token.slice(0, -2) + "zz";

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${tampered}&response=yes`);
    assert.equal(res.status, 401);
    const rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp, null);
  });

  test("a revoked token (accessTokenVersion bumped) no longer works", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-12T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);
    await prisma.tripParticipant.update({ where: { id: participant.id }, data: { accessTokenVersion: 1 } });

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`);
    assert.equal(res.status, 401);
  });

  test("an invalid response value is rejected", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-13T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(
      `/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=definitely`
    );
    assert.equal(res.status, 400);
  });

  test("a cancelled meeting's RSVP link is refused and records nothing", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-14T19:00:00.000Z"), cancelledAt: new Date() },
    });
    const token = buildTripParticipantAccessToken(participant);

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`);
    assert.equal(res.status, 400);
    const rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp, null);
  });

  test("a token for a different trip's meeting is refused", async () => {
    const { participant: otherParticipant } = await createTripWithParticipant();
    const { trip } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-15T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(otherParticipant);

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`);
    assert.equal(res.status, 404);
  });

  test("the self-service page shows myRsvp per meeting, never the raw rsvps array", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-17T19:00:00.000Z") },
    });
    const otherMeeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-18T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);

    // Before responding: null, and the raw per-participant-filtered
    // array must never leak through under its own key -- that would be
    // a real data-exposure bug if it ever included another participant's
    // row (see the next test), not just an API-shape nicety.
    let selfService = await anon(`/api/public/trips/participants/access?token=${token}`);
    let found = selfService.body.meetings.find((m) => m.id === meeting.id);
    assert.equal(found.myRsvp, null);
    assert.equal(found.rsvps, undefined);

    await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=maybe`);

    selfService = await anon(`/api/public/trips/participants/access?token=${token}`);
    found = selfService.body.meetings.find((m) => m.id === meeting.id);
    assert.equal(found.myRsvp, "maybe");
    // Responding to one meeting must not bleed into another on the same trip.
    const other = selfService.body.meetings.find((m) => m.id === otherMeeting.id);
    assert.equal(other.myRsvp, null);
  });

  test("myRsvp only ever reflects this participant's own response, not another participant's", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const otherParticipant = await prisma.tripParticipant.create({
      data: { tripId: trip.id, firstName: "Jordan", email: "jordan-rsvp@example.test" },
    });
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-19T19:00:00.000Z") },
    });
    const otherToken = buildTripParticipantAccessToken(otherParticipant);
    await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${otherToken}&response=yes`);

    const token = buildTripParticipantAccessToken(participant);
    const selfService = await anon(`/api/public/trips/participants/access?token=${token}`);
    const found = selfService.body.meetings.find((m) => m.id === meeting.id);
    assert.equal(found.myRsvp, null);
  });
});

// "Add to calendar" for the self-service page -- same token/ownership
// pattern as meeting RSVP above, reusing buildMeetingIcs unchanged.
describe("Trips: meeting .ics download", () => {
  const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

  async function createTripWithParticipant() {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Taylor", email: "taylor-ics@example.test" },
    });
    return { trip: trip.body, participant };
  }

  test("a valid token downloads a .ics whose SUMMARY carries the meeting's title", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: {
        tripId: trip.id,
        startAt: new Date("2026-12-20T19:00:00.000Z"),
        title: "Team Orientation Call",
      },
    });
    const token = buildTripParticipantAccessToken(participant);

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/ics?token=${token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/calendar/);
    assert.match(res.body, /SUMMARY:Team Orientation Call/);
  });

  test("a missing/invalid token is rejected", async () => {
    const { trip } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-21T19:00:00.000Z") },
    });
    const res = await anon(`/api/public/trips/meetings/${meeting.id}/ics?token=not-a-real-token`);
    assert.equal(res.status, 401);
  });

  test("a token for a different trip's meeting is refused", async () => {
    const { participant: otherParticipant } = await createTripWithParticipant();
    const { trip } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-22T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(otherParticipant);

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/ics?token=${token}`);
    assert.equal(res.status, 404);
  });
});

// Public self-service document upload (requirement self-serve round) --
// same token mechanism as meeting RSVP/esignature above, and the same
// shared multer config (backend/src/utils/upload.js) the admin upload
// route now also uses.
describe("Trips: public document-requirement upload", () => {
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

  // The document-requirement counterpart to the late-joiner meeting-invite
  // coverage in "Trips: meetings" above -- a participant added after a
  // document-kind requirement already exists would otherwise never learn
  // about it short of revisiting their own trip page unprompted.
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

  // Approving an application creates the participant through a separate
  // code path (its own tx.tripParticipant.create in PUT /applications/:id)
  // that previously got neither the future-meeting nor the document-
  // requirement catch-up -- it's plausibly the more common real-world way
  // someone becomes a participant at all, so this is the same coverage as
  // the direct-add tests above, just through application approval instead.
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

describe("Trips: trip-wide document title/fileSize, and participant visibility", () => {
  const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

  async function createTripWithParticipant() {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction" },
    });
    const participant = await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Riley", email: "riley-tripwide@example.test" },
    });
    return { trip: trip.body, participant };
  }

  test("an admin-uploaded trip-wide document stores the given title and fileSize", async () => {
    const { trip } = await createTripWithParticipant();
    const bytes = Buffer.from("packing list contents");
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "application/pdf" }), "packing-list.pdf");
    form.set("title", "Packing List");

    const res = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
    assert.equal(res.status, 201);

    const doc = await prisma.tripDocument.findFirst({ where: { tripId: trip.id, participantId: null } });
    assert.equal(doc.title, "Packing List");
    assert.equal(doc.fileSize, bytes.length);
  });

  test("the self-service response includes trip-wide documents but not another participant's own document", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const otherParticipant = await prisma.tripParticipant.create({
      data: { tripId: trip.id, firstName: "Other", email: "other-tripwide@example.test" },
    });

    // Trip-wide (participantId: null) -- should be visible to anyone on this trip.
    const tripWideForm = new FormData();
    tripWideForm.set(
      "file",
      new Blob([Buffer.from("itinerary")], { type: "application/pdf" }),
      "itinerary.pdf"
    );
    tripWideForm.set("title", "Flight Itinerary");
    const tripWideRes = await admin(`/api/trips/${trip.id}/documents`, {
      method: "POST",
      body: tripWideForm,
    });
    assert.equal(tripWideRes.status, 201);

    // The OTHER participant's own document -- must never appear in this
    // participant's self-service response under tripWideDocuments or
    // anywhere else.
    const otherForm = new FormData();
    otherForm.set(
      "file",
      new Blob([Buffer.from("their passport")], { type: "application/pdf" }),
      "passport.pdf"
    );
    otherForm.set("participantId", otherParticipant.id);
    const otherRes = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: otherForm });
    assert.equal(otherRes.status, 201);

    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(`/api/public/trips/participants/access?token=${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.tripWideDocuments.length, 1);
    assert.equal(res.body.tripWideDocuments[0].title, "Flight Itinerary");
    assert.ok(res.body.tripWideDocuments[0].fileSize > 0);
    assert.equal(res.body.tripWideDocuments[0].bytes, undefined, "metadata only, never the raw bytes");
  });

  test("a participant can download a trip-wide document via the token-gated route", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const bytes = Buffer.from("itinerary contents");
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "application/pdf" }), "itinerary.pdf");
    const uploadRes = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
    const docId = uploadRes.body.id;

    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(`/api/public/trips/participants/documents/${docId}/download?token=${token}`);
    assert.equal(res.status, 200);
  });

  test("the download route rejects a missing/invalid token", async () => {
    const { trip } = await createTripWithParticipant();
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("x")], { type: "application/pdf" }), "x.pdf");
    const uploadRes = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
    const docId = uploadRes.body.id;

    const res = await anon(
      `/api/public/trips/participants/documents/${docId}/download?token=not-a-real-token`
    );
    assert.equal(res.status, 401);
  });

  test("the download route refuses a participant-owned document, even with a valid token for that same trip", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const otherParticipant = await prisma.tripParticipant.create({
      data: { tripId: trip.id, firstName: "Other", email: "other-dl@example.test" },
    });
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("their passport")], { type: "application/pdf" }), "passport.pdf");
    form.set("participantId", otherParticipant.id);
    const uploadRes = await admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
    const docId = uploadRes.body.id;

    const token = buildTripParticipantAccessToken(participant);
    const res = await anon(`/api/public/trips/participants/documents/${docId}/download?token=${token}`);
    assert.equal(
      res.status,
      404,
      "a valid token for this trip still can't reach another participant's own document"
    );
  });
});
