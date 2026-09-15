const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
// Explicit rather than relying on ./helpers being required first --
// prismaClient reads DATABASE_URL at construction, so importing it before
// something has loaded .env fails with an opaque SASL error.
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

// The six collections hanging off a partner (trips, support entries,
// one-time needs, prayer requests, newsletters, documents). These are where
// the v2.0.0 partnerId migration touched the most code, and each router is
// now the *only* writer for its table -- the partner record's own PUT
// refuses them -- so the gates here are the whole story for that data.

let admin;
let editor;
let viewer;
let anon;
let partner;
let otherPartner;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, anon] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(null),
  ]);
  await removeFixturePartners();

  const a = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} collections host` },
  });
  const b = await admin("/api/partners", {
    method: "POST",
    body: { kind: "organization", orgType: "Local", displayName: `${FIXTURE_TAG} other host` },
  });
  partner = a.body;
  otherPartner = b.body;
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

// Each entry: the route, a minimal valid create body, and a field to edit.
// newsletters/documents are excluded here because they're multipart uploads
// rather than JSON -- they get their own describe block below.
function collectionCases() {
  return [
    {
      name: "trips",
      path: "/api/trips",
      create: () => ({ partnerId: partner.id, tripType: "Construction", description: "initial" }),
      patch: { description: "edited" },
      readBack: (r) => r.description,
      expectAfterPatch: "edited",
    },
    {
      name: "support-needs",
      path: "/api/support-needs",
      create: () => ({
        partnerId: partner.id,
        description: "A need",
        requestedAmount: 500,
        requestDate: "2026-01-01",
      }),
      patch: { approvedAmount: 250, approvedDate: "2026-02-01" },
      readBack: (r) => r.approvedAmount,
      expectAfterPatch: 250,
    },
    {
      name: "prayer-requests",
      path: "/api/prayer-requests",
      create: () => ({
        partnerId: partner.id,
        category: "situational",
        requestText: "A request",
        dateReceived: "2026-01-01",
      }),
      patch: { status: "answered", dateAnswered: "2026-03-01" },
      readBack: (r) => r.status,
      expectAfterPatch: "answered",
    },
  ];
}

describe("collections: auth gates", () => {
  for (const c of collectionCases()) {
    test(`${c.name}: unauthenticated is rejected`, async () => {
      assert.equal((await anon(c.path)).status, 401);
      assert.equal((await anon(c.path, { method: "POST", body: c.create() })).status, 401);
    });

    test(`${c.name}: viewer can read, cannot write`, async () => {
      assert.equal((await viewer(c.path)).status, 200);
      assert.equal((await viewer(c.path, { method: "POST", body: c.create() })).status, 403);
    });

    test(`${c.name}: editor can create but not delete`, async () => {
      const created = await editor(c.path, { method: "POST", body: c.create() });
      assert.equal(created.status, 201);
      assert.equal((await editor(`${c.path}/${created.body.id}`, { method: "DELETE" })).status, 403);
      await admin(`${c.path}/${created.body.id}`, { method: "DELETE" });
    });
  }

  test("support-entries: same gates, and admin-only delete", async () => {
    assert.equal((await anon("/api/support-entries")).status, 401);
    assert.equal((await viewer("/api/support-entries")).status, 200);
    const body = { partnerId: partner.id, amount: 100, effectiveDate: "2026-01-01" };
    assert.equal((await viewer("/api/support-entries", { method: "POST", body })).status, 403);
    const created = await editor("/api/support-entries", { method: "POST", body });
    assert.equal(created.status, 201);
    assert.equal((await editor(`/api/support-entries/${created.body.id}`, { method: "DELETE" })).status, 403);
    assert.equal((await admin(`/api/support-entries/${created.body.id}`, { method: "DELETE" })).status, 204);
  });
});

describe("collections: CRUD and partner scoping", () => {
  for (const c of collectionCases()) {
    test(`${c.name}: create, filter by partner, update, delete`, async () => {
      const created = await admin(c.path, { method: "POST", body: c.create() });
      assert.equal(created.status, 201);
      assert.equal(created.body.partnerId, partner.id);
      // The row carries its partner, so a list can render the name without
      // a second lookup.
      assert.equal(created.body.partner.displayName, partner.displayName);

      const mine = await admin(`${c.path}?partnerId=${partner.id}`);
      assert.ok(mine.body.some((r) => r.id === created.body.id));

      const theirs = await admin(`${c.path}?partnerId=${otherPartner.id}`);
      assert.ok(
        !theirs.body.some((r) => r.id === created.body.id),
        "filtering by a different partner must not return this row"
      );

      const updated = await admin(`${c.path}/${created.body.id}`, { method: "PUT", body: c.patch });
      assert.equal(updated.status, 200);
      assert.equal(c.readBack(updated.body), c.expectAfterPatch);

      assert.equal((await admin(`${c.path}/${created.body.id}`, { method: "DELETE" })).status, 204);
    });

    test(`${c.name}: rejects a create with no partnerId`, async () => {
      const { partnerId, ...withoutPartner } = c.create();
      const res = await admin(c.path, { method: "POST", body: withoutPartner });
      assert.equal(res.status, 400);
      assert.ok(Array.isArray(res.body.error));
      assert.deepEqual(res.body.error[0].path, ["partnerId"]);
    });
  }
});

describe("trips: participants", () => {
  test("participants are created with the trip and replaced wholesale on update", async () => {
    const created = await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        tripType: "Medical/Dental",
        participants: [{ name: "Alice", isLeader: true }, { name: "Bob" }],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.participants.length, 2);

    // Sending a participants array replaces the whole set rather than
    // merging -- simpler than tracking which row is "the same person", and
    // they carry nothing that recreating them loses.
    const updated = await admin(`/api/trips/${created.body.id}`, {
      method: "PUT",
      body: { participants: [{ name: "Carol", role: "Translator" }] },
    });
    assert.equal(updated.body.participants.length, 1);
    assert.equal(updated.body.participants[0].name, "Carol");

    // Omitting participants entirely leaves them alone.
    const untouched = await admin(`/api/trips/${created.body.id}`, {
      method: "PUT",
      body: { description: "just the description" },
    });
    assert.equal(untouched.body.participants.length, 1);
    assert.equal(untouched.body.participants[0].name, "Carol");

    await admin(`/api/trips/${created.body.id}`, { method: "DELETE" });
  });

  test("deleting a trip removes its participants", async () => {
    const created = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, participants: [{ name: "Temp" }] },
    });
    const tripId = created.body.id;
    assert.equal(await prisma.tripParticipant.count({ where: { tripId } }), 1);
    await admin(`/api/trips/${tripId}`, { method: "DELETE" });
    assert.equal(await prisma.tripParticipant.count({ where: { tripId } }), 0);
  });

  test("year and tripType filters narrow the cross-partner list", async () => {
    const a = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, tripType: "Prayer", startDate: "2021-06-01" },
    });
    const b = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.id, tripType: "Construction", startDate: "2024-06-01" },
    });

    const byType = await admin("/api/trips?tripType=Prayer");
    assert.ok(byType.body.some((t) => t.id === a.body.id));
    assert.ok(!byType.body.some((t) => t.id === b.body.id));

    const byYear = await admin("/api/trips?year=2024");
    assert.ok(byYear.body.some((t) => t.id === b.body.id));
    assert.ok(!byYear.body.some((t) => t.id === a.body.id));

    await admin(`/api/trips/${a.body.id}`, { method: "DELETE" });
    await admin(`/api/trips/${b.body.id}`, { method: "DELETE" });
  });
});

describe("support entries: append-only", () => {
  // A support entry records what the monthly amount was set to as of a
  // date, like a line in a ledger. Correcting one means deleting it and
  // adding another, so there is deliberately no update route at all.
  test("there is no update route", async () => {
    const created = await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: partner.id, amount: 100, effectiveDate: "2026-01-01" },
    });
    const res = await admin(`/api/support-entries/${created.body.id}`, {
      method: "PUT",
      body: { amount: 999 },
    });
    assert.equal(res.status, 404, "PUT must not be routed for support entries");
    await admin(`/api/support-entries/${created.body.id}`, { method: "DELETE" });
  });

  test("the latest effectiveDate is what counts as current", async () => {
    const older = await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: partner.id, amount: 100, effectiveDate: "2020-01-01" },
    });
    const newer = await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: partner.id, amount: 300, effectiveDate: "2026-01-01" },
    });

    const list = await admin(`/api/support-entries?partnerId=${partner.id}`);
    assert.equal(list.body[0].id, newer.body.id, "list is newest-effective-first");

    const summary = await admin(`/api/partners?kind=missionary`);
    const row = summary.body.find((p) => p.id === partner.id);
    assert.equal(row.supportEntries[0].amount, 300, "the summary row carries the current amount");

    await admin(`/api/support-entries/${older.body.id}`, { method: "DELETE" });
    await admin(`/api/support-entries/${newer.body.id}`, { method: "DELETE" });
  });
});

describe("documents: category rules", () => {
  // The one schema refinement that survived the merge: an "other" category
  // needs a free-typed label. It has to hold on a partial update too, where
  // either field can arrive on its own.
  function upload(fields) {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "t.pdf");
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return form;
  }

  test("category 'other' requires a customCategory on create", async () => {
    const res = await admin("/api/documents", {
      method: "POST",
      body: upload({ partnerId: partner.id, category: "other", receivedDate: "2026-01-01" }),
    });
    assert.equal(res.status, 400);
  });

  test("a valid document round-trips, downloads, and enforces the rule on update", async () => {
    const created = await admin("/api/documents", {
      method: "POST",
      body: upload({
        partnerId: partner.id,
        category: "survey_response",
        receivedDate: "2026-01-01",
        title: "Survey",
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(!("bytes" in created.body), "file bytes must never come back in a JSON response");

    const download = await admin(`/api/documents/${created.body.id}/download`);
    assert.equal(download.status, 200);

    // Switching to "other" without a label must be refused, even though the
    // body only carries one of the two fields.
    const bad = await admin(`/api/documents/${created.body.id}`, {
      method: "PUT",
      body: { category: "other" },
    });
    assert.equal(bad.status, 400);

    const good = await admin(`/api/documents/${created.body.id}`, {
      method: "PUT",
      body: { category: "other", customCategory: "Background Check" },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.customCategory, "Background Check");

    await admin(`/api/documents/${created.body.id}`, { method: "DELETE" });
  });

  test("rejects a file whose bytes don't match its declared type", async () => {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("not a pdf at all")], { type: "application/pdf" }), "fake.pdf");
    form.set("partnerId", partner.id);
    form.set("category", "office_document");
    form.set("receivedDate", "2026-01-01");
    const res = await admin("/api/documents", { method: "POST", body: form });
    assert.equal(res.status, 400);
    // Assert the *reason*, not just the status: an earlier version of the
    // test helper mangled FormData, so this passed on "No file provided"
    // while never exercising the signature check at all.
    assert.match(res.body.error, /doesn't match its declared type/);
  });
});

describe("collections: feature gates", () => {
  // Turning a feature off has to actually turn it off -- the router 404s
  // rather than 403s, so a disabled feature looks like it was never built.
  async function setFeature(key, on) {
    const current = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const enabledFeatures = { ...(current?.enabledFeatures || {}), [key]: on };
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", enabledFeatures },
      update: { enabledFeatures },
    });
  }

  test("disabling a feature 404s its whole router, for reads and writes alike", async () => {
    assert.equal((await admin("/api/trips")).status, 200);
    try {
      await setFeature("trips", false);
      assert.equal((await admin("/api/trips")).status, 404);
      assert.equal(
        (await admin("/api/trips", { method: "POST", body: { partnerId: partner.id } })).status,
        404
      );
    } finally {
      await setFeature("trips", true);
    }
    assert.equal((await admin("/api/trips")).status, 200, "re-enabling must restore the route");
  });
});

describe("collections: cascade", () => {
  test("deleting a partner takes its collections with it", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} cascade target` },
    });
    const id = created.body.id;

    await admin("/api/trips", { method: "POST", body: { partnerId: id, tripType: "Prayer" } });
    await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: id, amount: 50, effectiveDate: "2026-01-01" },
    });
    await admin("/api/prayer-requests", {
      method: "POST",
      body: { partnerId: id, category: "situational", requestText: "x", dateReceived: "2026-01-01" },
    });

    await admin(`/api/partners/${id}/archive`, { method: "POST" });
    assert.equal((await admin(`/api/partners/${id}`, { method: "DELETE" })).status, 204);

    assert.equal(await prisma.trip.count({ where: { partnerId: id } }), 0);
    assert.equal(await prisma.supportEntry.count({ where: { partnerId: id } }), 0);
    assert.equal(await prisma.prayerRequest.count({ where: { partnerId: id } }), 0);
  });
});
