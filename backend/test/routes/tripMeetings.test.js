// Trip meetings (#252/#267) -- split out of trips.test.js to mirror
// #271's route split (routes/tripMeetings.js). Meetings uplift
// (agenda/meetingLink as real fields, explicit resend, soft-cancel that
// notifies instead of silently vanishing), one-click RSVP, and the
// "add to calendar" .ics download.
//
// What's deliberately NOT here: the late-joiner catch-up tests for
// "adding a participant to a trip that already has meetings" live in
// tripParticipants.test.js instead -- the endpoint under test there is
// tripParticipants.js's own add/approve routes, not this file's, even
// though the email body they trigger is about an existing meeting. See
// that file's own header comment for the full reasoning.
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
    // #327 Finding 6: GET only renders a confirm page now; POST is what
    // actually records the RSVP (same path a mail client's own one-click
    // button, or clicking the rendered Confirm button, would take).
    const yesLink = body.match(/(https?:\/\/\S*\/rsvp\?token=\S*&response=yes)/)[1];
    const res = await anon(yesLink.replace(/^https?:\/\/[^/]*/, ""), { method: "POST" });
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

  // #327 Finding 6: this used to record the RSVP the moment the link was
  // *fetched* -- a mail security scanner pre-fetching all three yes/no/
  // maybe links in an inbox would record (and overwrite) whichever one
  // it requested last, never the recipient's real choice.
  test("GET renders a confirm page for that one response, without recording anything yet", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-09T12:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);

    const res = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Confirm attending/);

    const rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp, null, "GET must not record a response");
  });

  test("a valid token+response records it and overwrites on a later, different click", async () => {
    const { trip, participant } = await createTripWithParticipant();
    const meeting = await prisma.tripMeeting.create({
      data: { tripId: trip.id, startAt: new Date("2026-12-10T19:00:00.000Z") },
    });
    const token = buildTripParticipantAccessToken(participant);

    // #327 Finding 6: GET only renders a confirm page now; POST is what
    // actually records the RSVP.
    const yesRes = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=yes`, {
      method: "POST",
    });
    assert.equal(yesRes.status, 200);
    assert.match(yesRes.body, /attending/);
    let rsvp = await prisma.tripMeetingRsvp.findUnique({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
    });
    assert.equal(rsvp.response, "yes");

    const noRes = await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=no`, {
      method: "POST",
    });
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

    await anon(`/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=maybe`, {
      method: "POST",
    });

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
