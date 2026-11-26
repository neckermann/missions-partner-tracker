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
let editor;
let viewer;
let anon;

let originalSettings;
let originalEnabledFeatures;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, anon] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(null),
  ]);
  await removeFixturePartners();
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      churchName: true,
      contactFirstName: true,
      contactLastName: true,
      contactEmail: true,
      phone: true,
      websiteLink: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      stateProvinceRegion: true,
      postalCode: true,
      country: true,
    },
  });
  // trips defaults to off; the "collections are not writable through the partner record" test
  // creates a trip, so turn it on.
  const featureSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = featureSettings?.enabledFeatures ?? {};
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: { ...originalEnabledFeatures, trips: true } },
    create: { id: "singleton", enabledFeatures: { trips: true } },
  });
});

after(async () => {
  await removeFixturePartners();
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await removeTestUsers();
  await stopServer();
});

async function createPartner(overrides = {}) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} ${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

describe("partners: auth gates", () => {
  test("unauthenticated requests are rejected", async () => {
    assert.equal((await anon("/api/partners")).status, 401);
    assert.equal(
      (await anon("/api/partners", { method: "POST", body: { kind: "missionary", displayName: "x" } }))
        .status,
      401
    );
  });

  test("a viewer can read but not write", async () => {
    assert.equal((await viewer("/api/partners")).status, 200);
    const res = await viewer("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} viewer-attempt` },
    });
    assert.equal(res.status, 403);
  });

  test("an editor can write but cannot delete", async () => {
    const p = await createPartner();
    assert.equal(
      (await editor(`/api/partners/${p.id}`, { method: "PUT", body: { overview: "ok" } })).status,
      200
    );
    await editor(`/api/partners/${p.id}/archive`, { method: "POST" });
    assert.equal((await editor(`/api/partners/${p.id}`, { method: "DELETE" })).status, 403);
  });
});

describe("partners: validation", () => {
  // Regression test for two bugs in a row on the same line: every 400 serialized to {} (Zod v4
  // renamed ZodError.errors to .issues), then the fix returned err.issues, an array of objects
  // the frontend renders into JSX, which made React throw and blank the page. So the contract is
  // both halves: the body must name the offending field AND be a string. See
  // middleware/errors.js.
  test("a validation error names the offending field, as a string", async () => {
    const res = await admin("/api/partners", {
      method: "POST",
      body: { kind: "not-a-kind", displayName: "x" },
    });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string", `expected a string, got ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /kind/);
  });

  test("a missing required field is rejected", async () => {
    const res = await admin("/api/partners", { method: "POST", body: { kind: "missionary" } });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string");
    assert.match(res.body.error, /displayName/);
  });

  test("an unknown id returns 404, not 500", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.equal((await admin(`/api/partners/${missing}`)).status, 404);
    assert.equal(
      (await admin(`/api/partners/${missing}`, { method: "PUT", body: { overview: "x" } })).status,
      404
    );
  });

  // Without an explicit /api 404, an unmatched path falls through to the
  // SPA catch-all and comes back as index.html with a 200 -- so a client
  // calling a misspelled endpoint gets HTML and a confusing parse error
  // rather than a clear 404.
  test("an unmatched /api path returns a JSON 404, not the SPA shell", async () => {
    const res = await admin("/api/missionaries");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found" });

    const nonsense = await admin("/api/definitely-not-a-route");
    assert.equal(nonsense.status, 404);
    assert.deepEqual(nonsense.body, { error: "Not found" });
  });
});

describe("partners: read models", () => {
  test("the list returns summary rows, not every relation", async () => {
    await createPartner();
    const { status, body } = await admin("/api/partners");
    assert.equal(status, 200);
    const row = body[0];
    // The whole point of the summary select: a list row must not drag a
    // partner's entire history across the wire.
    for (const absent of [
      "trips",
      "needRequests",
      "prayerRequests",
      "newsletters",
      "documents",
      "adults",
      "children",
    ]) {
      assert.ok(!(absent in row), `summary row should not include ${absent}`);
    }
    assert.ok("displayName" in row && "kind" in row);
  });

  test("the detail record includes its own sub-records but not the history collections", async () => {
    const p = await createPartner({ addresses: { physical: { country: "Kenya" } } });
    const { status, body } = await admin(`/api/partners/${p.id}`);
    assert.equal(status, 200);
    assert.equal(body.addresses[0].country, "Kenya");
    for (const absent of [
      "trips",
      "supportEntries",
      "needRequests",
      "prayerRequests",
      "newsletters",
      "documents",
      "adults",
      "children",
      "furloughs",
      "churchVisits",
      "links",
      "languages",
      "tripTypes",
    ]) {
      assert.ok(!(absent in body), `detail record should not include ${absent}`);
    }
  });

  test("adults/children/furloughs/church visits/trip types created at creation time are reachable only through their own endpoints", async () => {
    const p = await createPartner({
      adults: [{ firstName: "Test", lastName: "Adult" }],
      children: [{ firstName: "Test", lastName: "Child" }],
      furloughs: [{ startDate: "2026-01-01" }],
      churchVisits: [{ visitDate: "2026-01-01" }],
      tripTypes: [{ type: "Construction" }],
    });

    const [adults, children, furloughs, churchVisits, tripTypes] = await Promise.all([
      admin(`/api/adults?partnerId=${p.id}`),
      admin(`/api/children?partnerId=${p.id}`),
      admin(`/api/furloughs?partnerId=${p.id}`),
      admin(`/api/church-visits?partnerId=${p.id}`),
      admin(`/api/trip-types?partnerId=${p.id}`),
    ]);
    assert.equal(adults.body.length, 1);
    assert.equal(adults.body[0].firstName, "Test");
    assert.equal(children.body.length, 1);
    assert.equal(children.body[0].firstName, "Test");
    assert.equal(children.body[0].lastName, "Child");
    assert.equal(furloughs.body.length, 1);
    assert.equal(churchVisits.body.length, 1);
    assert.equal(tripTypes.body.length, 1);
    assert.equal(tripTypes.body[0].type, "Construction");
  });

  test("kind and archived filters work", async () => {
    const org = await createPartner({ kind: "organization", orgType: "Local" });
    const orgs = await admin("/api/partners?kind=organization");
    assert.ok(orgs.body.some((r) => r.id === org.id));
    const missionaries = await admin("/api/partners?kind=missionary");
    assert.ok(!missionaries.body.some((r) => r.id === org.id));

    await admin(`/api/partners/${org.id}/archive`, { method: "POST" });
    const active = await admin("/api/partners?archived=false");
    assert.ok(!active.body.some((r) => r.id === org.id), "archived partner must be excluded");
  });
});

describe("partners: last prayed with congregation (#228)", () => {
  // A manual, Partner-level record of when the whole congregation last
  // prayed for this partner together -- distinct from any individual
  // PrayerRequest's own dateAnswered. Covers the same round trip the
  // frontend's "Mark Prayed Today"/edit-to-backdate actions rely on: set
  // via the ordinary partial PUT, read back off the detail record.
  test("defaults to null, then round-trips through PUT and GET", async () => {
    const p = await createPartner();
    assert.equal(p.lastPrayedWithCongregationAt, null);

    const updated = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { lastPrayedWithCongregationAt: "2026-11-01" },
    });
    assert.equal(updated.status, 200);
    assert.match(updated.body.lastPrayedWithCongregationAt, /^2026-11-01/);

    const read = await admin(`/api/partners/${p.id}`);
    assert.equal(read.status, 200);
    assert.match(read.body.lastPrayedWithCongregationAt, /^2026-11-01/);
  });

  test("can be backdated to a past date, not just today", async () => {
    const p = await createPartner();
    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { lastPrayedWithCongregationAt: "2026-09-15" },
    });
    assert.equal(res.status, 200);
    assert.match(res.body.lastPrayedWithCongregationAt, /^2026-09-15/);
  });

  test("can be cleared back to null (an empty date input sends null, not an invalid date)", async () => {
    const p = await createPartner({ lastPrayedWithCongregationAt: "2026-10-01" });
    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { lastPrayedWithCongregationAt: null },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.lastPrayedWithCongregationAt, null);
  });

  test("an editor can set it, same write permission as other partner content", async () => {
    const p = await createPartner();
    const res = await editor(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { lastPrayedWithCongregationAt: "2026-11-10" },
    });
    assert.equal(res.status, 200);
    assert.match(res.body.lastPrayedWithCongregationAt, /^2026-11-10/);
  });

  test("not included in the public partner view, same as other admin-only record-keeping fields", async () => {
    const p = await createPartner({
      isPublic: true,
      lastPrayedWithCongregationAt: "2026-11-05",
      overview: "Serving faithfully.",
    });
    const res = await anon(`/api/public/partners/${p.id}`);
    assert.equal(res.status, 200);
    assert.ok(!("lastPrayedWithCongregationAt" in res.body));
  });
});

describe("partners: collections are not writable through the partner record", () => {
  // The data-loss regression test: saving a partner once replaced every child collection
  // wholesale from the request body, so a stale form could silently delete rows added through a
  // collection's own endpoint since the form was opened.
  test("a partner save cannot delete rows owned by a collection endpoint", async () => {
    const p = await createPartner();

    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: p.id, type: "Construction", participants: [{ firstName: "Someone" }] },
    });
    assert.equal(trip.status, 201);
    const entry = await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: p.id, amount: 250, effectiveDate: "2026-01-01" },
    });
    assert.equal(entry.status, 201);

    // Save the partner while sending empty collection arrays, as a stale edit form would.
    const saved = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: {
        overview: "edited",
        trips: [],
        supportEntries: [],
        needRequests: [],
        prayerRequests: [],
        newsletters: [],
        documents: [],
      },
    });
    assert.equal(saved.status, 200);

    const trips = await admin(`/api/trips?partnerId=${p.id}`);
    const entries = await admin(`/api/support-entries?partnerId=${p.id}`);
    assert.equal(trips.body.length, 1, "trip must survive a partner save");
    assert.equal(trips.body[0].id, trip.body.id, "trip id must be unchanged, not recreated");
    assert.equal(entries.body.length, 1, "support entry must survive a partner save");
    assert.equal(entries.body[0].id, entry.body.id, "support entry id must be unchanged");

    const after = await admin(`/api/partners/${p.id}`);
    assert.equal(after.body.overview, "edited", "the scalar edit should still apply");
  });

  test("sub-records the partner record does own are still replaced on save", async () => {
    const p = await createPartner({ addresses: { physical: { country: "First Country" } } });
    await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { addresses: { physical: { country: "Second Country" } } },
    });
    const { body } = await admin(`/api/partners/${p.id}`);
    assert.equal(body.addresses.length, 1);
    assert.equal(body.addresses[0].country, "Second Country");
  });

  test("a partner save cannot delete adults/children/furloughs/church visits/links/languages/trip types either", async () => {
    const p = await createPartner({ adults: [{ firstName: "Original" }] });

    const [adult, link, language, tripType] = await Promise.all([
      admin("/api/adults", { method: "POST", body: { partnerId: p.id, firstName: "Added" } }),
      admin("/api/partner-links", {
        method: "POST",
        body: { partnerId: p.id, type: "website", url: "https://example.com" },
      }),
      admin("/api/partner-languages", {
        method: "POST",
        body: { partnerId: p.id, language: "Spanish" },
      }),
      admin("/api/trip-types", {
        method: "POST",
        body: { partnerId: p.id, type: "Construction" },
      }),
    ]);
    assert.equal(adult.status, 201);
    assert.equal(link.status, 201);
    assert.equal(language.status, 201);
    assert.equal(tripType.status, 201);

    const saved = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: {
        overview: "edited again",
        adults: [],
        children: [],
        furloughs: [],
        churchVisits: [],
        links: [],
        languages: [],
        tripTypes: [],
      },
    });
    assert.equal(saved.status, 200);

    const adults = await admin(`/api/adults?partnerId=${p.id}`);
    const links = await admin(`/api/partner-links?partnerId=${p.id}`);
    const languages = await admin(`/api/partner-languages?partnerId=${p.id}`);
    const tripTypes = await admin(`/api/trip-types?partnerId=${p.id}`);
    assert.equal(adults.body.length, 2, "both adults (creation-time and added after) must survive");
    assert.equal(links.body.length, 1, "link must survive a partner save");
    assert.equal(languages.body.length, 1, "language must survive a partner save");
    assert.equal(tripTypes.body.length, 1, "trip type must survive a partner save");
  });
});

describe("partners: archive before delete", () => {
  test("deleting an unarchived partner is refused", async () => {
    const p = await createPartner();
    const res = await admin(`/api/partners/${p.id}`, { method: "DELETE" });
    assert.equal(res.status, 400);
  });

  test("archiving zeroes support, unpublishes, then permits delete", async () => {
    const p = await createPartner({ isPublic: true });
    const archived = await admin(`/api/partners/${p.id}/archive`, { method: "POST" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.archived, true);
    assert.equal(archived.body.isPublic, false, "archiving must pull the record off the public site");

    const entries = await admin(`/api/support-entries?partnerId=${p.id}`);
    assert.equal(entries.body[0].amount, 0, "archiving records a $0 support entry");

    assert.equal((await admin(`/api/partners/${p.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await admin(`/api/partners/${p.id}`)).status, 404);
  });
});

describe("partners: Sent by our church auto-fills Sending Church", () => {
  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        churchName: `${FIXTURE_TAG} Hillside Community Church`,
        contactFirstName: "Amy",
        contactLastName: "Draycott",
        contactEmail: "missions@example.org",
        phone: "555-0100",
        websiteLink: "https://example.org",
        addressLine1: "1 Main St",
        city: "Rock Island",
        country: "USA",
      },
    });
  });

  test("checking it at creation fills every Sending Church field from Church Settings", async () => {
    const p = await createPartner({ sentByOurChurch: true });
    assert.equal(p.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);
    assert.equal(p.sendingChurch.contactFirstName, "Amy");
    assert.equal(p.sendingChurch.contactLastName, "Draycott");
    assert.equal(p.sendingChurch.contactEmail, "missions@example.org");
    assert.equal(p.sendingChurch.phone, "555-0100");
    assert.equal(p.sendingChurch.websiteLink, "https://example.org");
    assert.equal(p.sendingChurch.mailingAddress.city, "Rock Island");
  });

  test("checking it later (PUT) overwrites anything already typed with current Church Settings", async () => {
    const p = await createPartner({
      sentByOurChurch: false,
      sendingChurch: { name: "Already Typed Name" },
    });
    assert.equal(p.sendingChurch.name, "Already Typed Name");

    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { sentByOurChurch: true },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.body.sendingChurch.name,
      `${FIXTURE_TAG} Hillside Community Church`,
      "checking it pulls the current Church Settings value, not what was already typed"
    );
    assert.equal(res.body.sendingChurch.contactFirstName, "Amy");
    assert.equal(res.body.sendingChurch.contactLastName, "Draycott");
  });

  test("checking it is never overridden by this same save's own sendingChurch payload -- Church Settings always wins", async () => {
    const p = await createPartner({
      sentByOurChurch: true,
      sendingChurch: { name: "Explicit Name", contactFirstName: "Explicit", contactLastName: "Contact" },
    });
    assert.equal(
      p.sendingChurch.name,
      `${FIXTURE_TAG} Hillside Community Church`,
      "checking the box means this partner's Sending Church IS the church, not a custom value"
    );
    assert.equal(p.sendingChurch.contactFirstName, "Amy");
    assert.equal(p.sendingChurch.contactLastName, "Draycott");
  });

  // Regression test: the admin UI's Sending Church box saves sentByOurChurch and sendingChurch
  // together in one PUT even when every Sending Church field is blank (see
  // AdminPartnerDetail.jsx's Sending Church loop). The auto-fill must still run for that shape;
  // keying it off "did this payload include its own sendingChurch at all" skipped it for the
  // real form and only worked for a hand-crafted API call.
  test("checking it via a save that bundles blank sendingChurch fields still fills in from Church Settings", async () => {
    const p = await createPartner({ sentByOurChurch: false });

    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: {
        sentByOurChurch: true,
        sendingChurch: {
          name: "",
          contactFirstName: "",
          contactLastName: "",
          contactEmail: "",
          phone: "",
          websiteLink: "",
          mailingAddress: {
            addressLine1: "",
            addressLine2: "",
            city: "",
            stateProvinceRegion: "",
            postalCode: "",
            country: "",
          },
        },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);
    assert.equal(res.body.sendingChurch.contactFirstName, "Amy");
    assert.equal(res.body.sendingChurch.contactLastName, "Draycott");
  });

  // The real Sending Church box always saves its full draft object (see the
  // "bundles blank fields" test above), so a deliberate edit sends every
  // field back, not just the one the user touched. This confirms that shape
  // specifically: contactName etc. are resent unchanged alongside the
  // cleared name, and since sentByOurChurch was already true going in (no
  // false->true transition), the fill must not re-run and undo the clear.
  test("re-saving while already checked doesn't re-run the fill and clobber a field just cleared", async () => {
    const p = await createPartner({ sentByOurChurch: true });
    assert.equal(p.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);

    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: {
        sentByOurChurch: true,
        sendingChurch: {
          name: "",
          contactFirstName: p.sendingChurch.contactFirstName,
          contactLastName: p.sendingChurch.contactLastName,
          contactEmail: p.sendingChurch.contactEmail,
          phone: p.sendingChurch.phone,
          websiteLink: p.sendingChurch.websiteLink,
          mailingAddress: p.sendingChurch.mailingAddress,
        },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.sendingChurch.name, "", "a deliberate clear isn't silently refilled");
    assert.equal(
      res.body.sendingChurch.contactFirstName,
      "Amy",
      "fields resent unchanged in the same save survive"
    );
    assert.equal(res.body.sendingChurch.contactLastName, "Draycott");
  });

  test("unchecking it never clears anything already filled in", async () => {
    const p = await createPartner({ sentByOurChurch: true });
    assert.equal(p.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);

    const res = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { sentByOurChurch: false },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.sentByOurChurch, false);
    assert.equal(
      res.body.sendingChurch.name,
      `${FIXTURE_TAG} Hillside Community Church`,
      "unchecking is a one-way fill, not a sync -- it never clears what was filled in"
    );
  });
});

describe("partners: bulk Sending Church sync (POST /sync-sending-church)", () => {
  before(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        churchName: `${FIXTURE_TAG} Hillside Community Church`,
        contactFirstName: "Amy",
        contactLastName: "Draycott",
        contactEmail: "missions@example.org",
        phone: "555-0100",
        websiteLink: "https://example.org",
        addressLine1: "1 Main St",
        city: "Rock Island",
        country: "USA",
      },
    });
  });

  test("unauthenticated and non-admin requests are rejected", async () => {
    assert.equal((await anon("/api/partners/sync-sending-church", { method: "POST" })).status, 401);
    assert.equal((await viewer("/api/partners/sync-sending-church", { method: "POST" })).status, 403);
    assert.equal((await editor("/api/partners/sync-sending-church", { method: "POST" })).status, 403);
  });

  test("overwrites every sent-by-us partner's Sending Church with current Church Settings, leaves others alone", async () => {
    const stale = await createPartner({
      sentByOurChurch: true,
      sendingChurch: { name: "Stale Name", contactFirstName: "Old", contactLastName: "Contact" },
    });
    const alsoStale = await createPartner({
      sentByOurChurch: true,
      sendingChurch: { name: "Another Stale Name" },
    });
    const notSentByUs = await createPartner({
      sentByOurChurch: false,
      sendingChurch: { name: "Untouched Name" },
    });

    const res = await admin("/api/partners/sync-sending-church", { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(res.body.updatedCount >= 2, `expected at least 2 updated, got ${res.body.updatedCount}`);

    const [staleAfter, alsoStaleAfter, untouchedAfter] = await Promise.all([
      admin(`/api/partners/${stale.id}`),
      admin(`/api/partners/${alsoStale.id}`),
      admin(`/api/partners/${notSentByUs.id}`),
    ]);
    assert.equal(staleAfter.body.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);
    assert.equal(staleAfter.body.sendingChurch.contactFirstName, "Amy");
    assert.equal(staleAfter.body.sendingChurch.contactLastName, "Draycott");
    assert.equal(alsoStaleAfter.body.sendingChurch.name, `${FIXTURE_TAG} Hillside Community Church`);
    assert.equal(
      untouchedAfter.body.sendingChurch.name,
      "Untouched Name",
      "a partner not marked sent-by-us is never touched by the bulk sync"
    );
  });

  test("GET /api/settings reports how many partners are marked sent-by-us", async () => {
    const before = (await admin("/api/settings")).body.sentByOurChurchCount;
    await createPartner({ sentByOurChurch: true });
    const after = (await admin("/api/settings")).body.sentByOurChurchCount;
    assert.equal(after, before + 1);
  });
});

describe("POST /:id/image -- photo upload, including HEIC transcoding", () => {
  let partnerId;

  before(async () => {
    const p = await createPartner();
    partnerId = p.id;
  });

  function uploadForm(buffer, filename, mimeType) {
    const form = new FormData();
    form.set("image", new Blob([buffer], { type: mimeType }), filename);
    return form;
  }

  test("accepts a real JPEG", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(jpeg, "photo.jpg", "image/jpeg"),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.photos[0].id != null, true);
  });

  test("rejects content that doesn't match its declared type", async () => {
    const notAnImage = Buffer.from("<script>alert(1)</script>");
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(notAnImage, "photo.jpg", "image/jpeg"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /doesn't match/);
  });

  // Real ftyp box + "heic" major brand -- passes the signature check (see
  // fileSignature.test.js) but isn't a genuine, fully-formed HEIC image, so
  // heic-convert can't actually decode it. Standing in for a real but
  // corrupted/truncated upload, which is the realistic failure mode here
  // (not a forged file, an incomplete one).
  const heicSignatureOnly = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypheic"),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
  ]);

  test("a HEIC upload that can't actually be decoded 400s cleanly, not a 500", async () => {
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(heicSignatureOnly, "photo.heic", "image/heic"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /HEIC/);
  });

  test("a HEIC file is still recognized when the browser reports no usable MIME type", async () => {
    // Real-world case this exists for: Windows browsers in particular often
    // report application/octet-stream (or nothing) for a .heic file, since
    // there's no OS-level MIME registration for it -- resolveImageExt falls
    // back to the filename extension, and the signature check still
    // verifies against "image/heic" rather than trusting the unreliable
    // declared type.
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(heicSignatureOnly, "photo.heic", "application/octet-stream"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /HEIC/, "reached the decode step, not rejected as an unknown type");
  });

  test("rejects a non-HEIC file with a .heic extension -- the extension fallback doesn't bypass signature verification", async () => {
    const notHeic = Buffer.from("<script>alert(1)</script>");
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(notHeic, "photo.heic", "application/octet-stream"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /doesn't match/);
  });

  test("rejects an unsupported file type", async () => {
    const res = await admin(`/api/partners/${partnerId}/image`, {
      method: "POST",
      body: uploadForm(Buffer.from("GIF89a"), "photo.gif", "image/gif"),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /JPEG, PNG, WebP, or HEIC/);
  });
});
