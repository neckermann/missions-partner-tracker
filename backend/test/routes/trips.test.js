// Trips: focused coverage of the parts most likely to be gotten wrong by generic instinct: the
// feature-gate split between `trips` and `publicTripDiscovery`, the restricted-partner
// mask-vs-exclude split across public surfaces, the lost-link recovery route's
// enumeration-prevention guarantee, trip-level reschedule-resend and trip-wide documents.
// Ordinary CRUD is covered by collections.test.js/errors.test.js's shared parameterized cases.
// Meetings are in tripMeetings.test.js, requirements in tripRequirements.test.js, and
// late-joiner/approval catch-up in tripParticipants.test.js.
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

// A tiny buffer that really is a PDF as far as the upload check can tell (it starts with the PDF signature).
const pdfBytes = (text) => Buffer.from(`%PDF-1.4\n${text}`);

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

// An EXISTING participant, not a new one (unlike the late-joiner suite in
// tripParticipants.test.js): every participant's welcome email attaches the trip-dates .ics,
// so a later change to startDate/endDate must resend it or their calendar keeps the old dates.
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

  // The update must not be silently dropped: sendTripDatesUpdateEmail returns the same
  // manualFallback() shape every other sender in tripEmails.js returns, surfaced on the response
  // as `datesUpdateEmail`.
  test("outboundEmail off hands back a manual link instead of silently dropping the resend", async () => {
    await setFeatures({ outboundEmail: false });
    try {
      const { trip } = await createTripWithParticipant();
      const sent = await captureEmails(async () => {
        const res = await admin(`/api/trips/${trip.id}`, {
          method: "PUT",
          body: { startDate: "2026-12-05" },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.datesUpdateEmail?.sent, false);
        assert.equal(res.body.datesUpdateEmail?.manual?.length, 1);
        assert.equal(res.body.datesUpdateEmail.manual[0].email, "jamie-reschedule@example.test");
        assert.match(res.body.datesUpdateEmail.manual[0].url, /^https?:\/\//);
      });
      assert.equal(sent.length, 0, "outboundEmail off must still suppress the real send");
    } finally {
      await setFeatures({ outboundEmail: true });
    }
  });

  test("outboundEmail on reports sent:true, no manual link", async () => {
    const { trip } = await createTripWithParticipant();
    const res = await admin(`/api/trips/${trip.id}`, { method: "PUT", body: { startDate: "2026-12-05" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.datesUpdateEmail, { sent: true });
  });
});

// Setting dates is also the first moment it's worth re-checking whether anyone on the roster
// is owed a catch-up for a meeting/requirement that didn't exist when they joined (a direct
// add or approved application only runs catch-up once, at join time). The `since:
// participant.createdAt` scoping is what must be right: re-sending for something that already
// existed at join time would be a duplicate-send regression, and these tests pin that down,
// not just that the new path fires.
describe("Trips: setting dates re-checks late-joiner catch-up", () => {
  async function captureEmails(run) {
    const captured = [];
    const prevFetch = global.fetch;
    global.fetch = (url, options) => {
      if (String(url).startsWith("https://api.postmarkapp.com") && options?.body) {
        try {
          captured.push(JSON.parse(options.body));
        } catch {
          /* non-JSON body */
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

  test("a meeting added after a dateless participant joined is caught up on once dates are set, not re-sent for one that existed before they joined", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, type: "Construction", status: "planning" }, // no dates yet
    });

    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2027-01-10T19:00:00.000Z", title: "Orientation" },
    });

    // Joins while the trip has no dates -- isTripHistorical is false for
    // a dateless trip, so the normal join-time catch-up already runs and
    // already covers earlyMeeting; it must not be re-sent below.
    const joinSent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Late", lastName: "Joiner", email: "late-joiner-310@example.test" },
      });
      assert.equal(res.status, 201);
    });
    const earlyInvite = joinSent.find((m) => /^Meeting: Orientation/.test(m.Subject));
    assert.ok(earlyInvite, "join-time catch-up must cover the meeting that already existed");

    // A second meeting is added AFTER the participant joined: nothing re-checks this participant
    // for it until dates get set.
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2027-01-17T19:00:00.000Z", title: "Packing session" },
    });

    const dateSent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}`, {
        method: "PUT",
        body: { startDate: "2026-12-20", endDate: "2026-12-27" },
      });
      assert.equal(res.status, 200);
    });

    const earlyInviteResent = dateSent.filter((m) => /^Meeting: Orientation/.test(m.Subject));
    assert.equal(
      earlyInviteResent.length,
      0,
      "a meeting that already existed when the participant joined must not be re-sent just because dates changed"
    );
    const lateInvite = dateSent.find((m) => /^Meeting: Packing session/.test(m.Subject));
    assert.ok(
      lateInvite,
      "a meeting added after the participant joined must be caught up on once dates are set"
    );
    assert.equal(lateInvite.To, "late-joiner-310@example.test");

    // Plus the trip-dates-update email itself, to the same participant (confirmed above): expected
    // in this count, so dateSent.length is 2.
    assert.equal(dateSent.length, 2, "exactly the new meeting's catch-up plus the dates-update email itself");
  });

  test("a participant who joined after a meeting already existed gets no duplicate when dates later change", async () => {
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
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2027-01-10T19:00:00.000Z", title: "Orientation" },
    });
    const joined = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}/participants`, {
        method: "POST",
        body: { firstName: "Normal", lastName: "Joiner", email: "normal-joiner-310@example.test" },
      });
      assert.equal(res.status, 201);
    });
    assert.ok(
      joined.some((m) => /^Meeting: Orientation/.test(m.Subject)),
      "sanity check: join-time catch-up fired as expected"
    );

    const dateSent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}`, {
        method: "PUT",
        body: { startDate: "2026-12-02" },
      });
      assert.equal(res.status, 200);
    });
    const duplicateInvite = dateSent.find((m) => /^Meeting: Orientation/.test(m.Subject));
    assert.equal(
      duplicateInvite,
      undefined,
      "a meeting the participant was already caught up on at join time must not be re-sent on an unrelated dates change"
    );
    // The dates-update email itself still goes out, confirming this test's dates PUT did something
    // rather than silently no-op'ing.
    assert.equal(dateSent.length, 1);
    assert.match(dateSent[0].Subject, /^Trip dates updated:/);
  });

  test("a completed trip skips the re-check entirely", async () => {
    const partner = await createPartner();
    const trip = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        type: "Construction",
        status: "planning",
      },
    });
    await prisma.tripParticipant.create({
      data: { tripId: trip.body.id, firstName: "Hist", email: "historical-310@example.test" },
    });
    await prisma.tripMeeting.create({
      data: { tripId: trip.body.id, startAt: "2027-02-01T19:00:00.000Z", title: "Should not notify" },
    });

    const sent = await captureEmails(async () => {
      const res = await admin(`/api/trips/${trip.body.id}`, {
        method: "PUT",
        body: { status: "completed", startDate: "2020-01-01", endDate: "2020-01-08" },
      });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 0, "a completed trip must not run the catch-up re-check (or the dates email)");
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
    const bytes = pdfBytes("packing list contents");
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
    tripWideForm.set("file", new Blob([pdfBytes("itinerary")], { type: "application/pdf" }), "itinerary.pdf");
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
      new Blob([pdfBytes("their passport")], { type: "application/pdf" }),
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
    const bytes = pdfBytes("itinerary contents");
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
    form.set("file", new Blob([pdfBytes("x")], { type: "application/pdf" }), "x.pdf");
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
    form.set("file", new Blob([pdfBytes("their passport")], { type: "application/pdf" }), "passport.pdf");
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

describe("GET /api/trips/planning", () => {
  test("reads trip types from the TripType relation, not the old tripTypesSupported column", async () => {
    const partner = await createPartner({
      tripTeamSizeMin: 3,
      tripTeamSizeMax: 10,
      tripTypes: [{ type: "Construction" }, { type: "Medical/Dental" }],
    });

    const res = await admin("/api/trips/planning");
    assert.equal(res.status, 200);
    const row = res.body.find((r) => r.partnerId === partner.id);
    assert.ok(row, "partner with at least one trip type should appear in the planning list");
    assert.deepEqual(row.tripTypesSupported, ["Construction", "Medical/Dental"]);
  });

  test("a partner with no trip types at all is excluded", async () => {
    const partner = await createPartner();
    const res = await admin("/api/trips/planning");
    assert.equal(res.status, 200);
    assert.ok(!res.body.some((r) => r.partnerId === partner.id));
  });
});

// H6: the admin document upload checks what the file really is, as partner files, photos and the participants' own
// uploads do, instead of trusting the type the browser reported. Without it a script or HTML page labelled as a PDF
// would be stored, and handed to a participant, under that label.
describe("Trips: a document's real type is checked on upload", () => {
  async function aTrip() {
    const partner = await createPartner();
    return (
      await admin("/api/trips", { method: "POST", body: { partnerId: partner.id, type: "Construction" } })
    ).body;
  }
  const upload = (trip, bytes, type, name) => {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type }), name);
    return admin(`/api/trips/${trip.id}/documents`, { method: "POST", body: form });
  };

  test("a file that says it is a PDF but is not one is refused, and nothing is stored", async () => {
    const trip = await aTrip();
    const res = await upload(
      trip,
      Buffer.from("<html><script>alert(1)</script></html>"),
      "application/pdf",
      "evil.pdf"
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /doesn't match its declared type/);
    assert.equal(await prisma.tripDocument.count({ where: { tripId: trip.id } }), 0);
  });

  test("a PDF that is a PDF is accepted, and stored under the type its content proves", async () => {
    const trip = await aTrip();
    const res = await upload(trip, pdfBytes("real"), "application/pdf", "real.pdf");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = await prisma.tripDocument.findFirst({ where: { tripId: trip.id } });
    assert.equal(doc.contentType, "application/pdf");
  });

  test("a PNG, a JPEG and a WEBP are accepted on their real bytes, and text calling itself a PNG is not", async () => {
    const trip = await aTrip();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP"),
      Buffer.from([0, 0]),
    ]);
    assert.equal((await upload(trip, png, "image/png", "a.png")).status, 201);
    assert.equal((await upload(trip, jpeg, "image/jpeg", "a.jpg")).status, 201);
    assert.equal((await upload(trip, webp, "image/webp", "a.webp")).status, 201);
    assert.equal((await upload(trip, Buffer.from("not a png"), "image/png", "fake.png")).status, 400);
    assert.equal(
      (await upload(trip, pdfBytes("a pdf"), "image/png", "wrong-label.png")).status,
      400,
      "a PDF labelled PNG"
    );
  });

  test("a type that is not allowed at all is still refused up front", async () => {
    const trip = await aTrip();
    assert.equal((await upload(trip, Buffer.from("just text"), "text/plain", "notes.txt")).status, 400);
  });
});
