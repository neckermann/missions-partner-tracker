// Trips (#252) -- focused coverage of the parts most likely to be gotten
// wrong by generic instinct: the feature-gate split between `trips` and
// `publicTripDiscovery`, the restricted-partner mask-vs-exclude split
// across public surfaces, and the lost-link recovery route's
// enumeration-prevention guarantee -- plus trip-level reschedule-resend
// and trip-wide documents. Ordinary CRUD is already covered by
// collections.test.js/errors.test.js's shared parameterized cases.
//
// Split out of a single, much larger trips.test.js to mirror #271's
// route split (routes/trips.js -> trips.js/tripMeetings.js/
// tripRequirements.js/tripParticipants.js): this file now covers only
// what's left of trips.js itself. Meeting CRUD/RSVP/.ics coverage moved
// to tripMeetings.test.js; requirement CRUD/upload/fulfillment coverage
// moved to tripRequirements.test.js; late-joiner/approval catch-up
// coverage (adding or approving a participant into a trip that already
// has meetings and/or requirements) moved to tripParticipants.test.js --
// see that file's own header comment for why those stayed together
// rather than splitting further by which domain the catch-up email
// happens to be about.
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

// A different gap than the late-joiner suite in tripParticipants.test.js:
// an EXISTING participant, not a new one. Every participant's welcome
// email attaches the trip-dates .ics at the moment they join -- but
// nothing used to resend it if an admin later changed startDate/endDate,
// so an existing participant's calendar kept showing the old, now-wrong
// dates.
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
