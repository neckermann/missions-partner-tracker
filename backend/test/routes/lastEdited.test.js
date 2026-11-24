// "Last edited by" (#341): the Prisma client extension stamps who changed a
// record, centrally, from the signed-in user of the request. Current-state, kept
// for good, and a snapshot of the name so it still reads after that account is
// deleted. Background writes (no signed-in person) leave it alone.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
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
let adminRow;
let originalFeatures;
const extraUsers = [];
const cleanupTrips = [];

describe("last edited by", () => {
  before(async () => {
    // The trip checks below need Trips on, whatever an earlier test file left.
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    originalFeatures = current?.enabledFeatures ?? {};
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { enabledFeatures: { ...originalFeatures, trips: true } },
      create: { id: "singleton", enabledFeatures: { ...originalFeatures, trips: true } },
    });
    await ensureTestUsers();
    await prisma.user.updateMany({
      where: { email: "route-test-admin@example.test" },
      data: { firstName: "Ada", lastName: "Admin" },
    });
    admin = await client("admin");
    adminRow = await prisma.user.findUnique({ where: { email: "route-test-admin@example.test" } });
  });
  after(async () => {
    await prisma.trip.deleteMany({ where: { name: { contains: FIXTURE_TAG } } });
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: originalFeatures },
    });
    await removeFixturePartners();
    await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
    await removeTestUsers();
    await stopServer();
  });

  test("a partner created through the API carries who made it, and when", async () => {
    const before = Date.now();
    const res = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Stamped` },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await prisma.partner.findUnique({ where: { id: res.body.id } });
    assert.equal(row.lastEditedById, adminRow.id);
    assert.equal(row.lastEditedByName, "Ada Admin");
    assert.ok(row.lastEditedAt.getTime() >= before - 1000);
  });

  test("an edit by someone else moves it to them; the first editor is not remembered", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Two editors` },
    });
    const editorEmail = "last-edited-editor@example.test";
    const password = "LastEdited123!";
    const editor = await prisma.user.create({
      data: {
        email: editorEmail,
        firstName: "Eddie",
        lastName: "Editor",
        passwordHash: await bcrypt.hash(password, 4),
        role: "editor",
        authProvider: "local",
        active: true,
      },
    });
    extraUsers.push(editor.id);
    const asEditor = await client({ email: editorEmail, password });
    const res = await asEditor(`/api/partners/${created.body.id}`, {
      method: "PUT",
      body: { overview: "changed" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.partner.findUnique({ where: { id: created.body.id } });
    assert.equal(row.lastEditedByName, "Eddie Editor");
    assert.equal(row.lastEditedById, editor.id);
  });

  test("the name survives the editor's account being deleted", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Orphaned editor` },
    });
    await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
    const row = await prisma.partner.findUnique({ where: { id: created.body.id } });
    assert.equal(row.lastEditedByName, "Ada Admin");
    const stale = await prisma.partner.findFirst({ where: { displayName: `${FIXTURE_TAG} Two editors` } });
    assert.equal(stale.lastEditedByName, "Eddie Editor", "snapshot kept after the editor was deleted");
  });

  test("a write with no signed-in person stamps nothing and leaves the old stamp alone", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Background` },
    });
    await prisma.partner.update({ where: { id: created.body.id }, data: { overview: "by a job" } });
    const row = await prisma.partner.findUnique({ where: { id: created.body.id } });
    assert.equal(row.lastEditedByName, "Ada Admin");
    const bare = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Never edited by a person` },
    });
    assert.equal(bare.lastEditedById, null);
    assert.equal(bare.lastEditedAt, null);
  });

  test("a nested create stamps the partner it was written through, and a child edited directly is stamped too", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} With adult`,
        adults: [{ firstName: "Pat" }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const adult = await prisma.adult.findFirst({ where: { partnerId: created.body.id } });
    const res = await admin(`/api/adults/${adult.id}`, { method: "PUT", body: { lastName: "Smith" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await prisma.adult.findUnique({ where: { id: adult.id } });
    assert.equal(after.lastEditedByName, "Ada Admin");
  });

  test("who last edited a record is never exposed on the public site", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Public one`, isPublic: true },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const anon = await client();
    const list = await anon("/api/public/partners");
    const one = await anon(`/api/public/partners/${created.body.id}`);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    for (const res of [list, one]) {
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes("lastEdited"), "lastEdited* leaked publicly");
      assert.ok(!text.includes("Ada Admin"), "an editor's name leaked publicly");
    }
  });

  test("prayer requests and needs carry who last edited them, and the completeness report shows partners'", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Items` },
    });
    const prayer = await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId: partner.body.id,
        category: "strategic",
        requestText: "pray",
        dateReceived: "2026-11-01",
      },
    });
    assert.equal(prayer.status, 201, JSON.stringify(prayer.body));
    const need = await admin("/api/support-needs", {
      method: "POST",
      body: {
        partnerId: partner.body.id,
        description: "need",
        requestedAmount: 100,
        requestDate: "2026-11-01",
      },
    });
    assert.equal(need.status, 201, JSON.stringify(need.body));
    assert.equal(prayer.body.lastEditedByName, "Ada Admin");
    assert.equal(need.body.lastEditedByName, "Ada Admin");

    const prayerReport = await admin("/api/reports/prayer-requests?status=all&includeArchived=true");
    assert.equal(prayerReport.status, 200, JSON.stringify(prayerReport.body).slice(0, 200));
    assert.ok(
      !prayerReport.body.columns.some((c) => c.key === "editedBy"),
      "the prayer report stays compact"
    );
    const completeness = await admin("/api/reports/data-completeness?includeArchived=true");
    const row = completeness.body.rows.find((r) => String(r.partnerName).includes("Items"));
    assert.equal(row.editedBy, "Ada Admin");
    assert.match(row.editedOn, /^\d{4}-\d{2}-\d{2}$/);
    const csv = await admin("/api/reports/data-completeness?includeArchived=true&format=csv");
    assert.ok(csv.body.includes("Last edited by"));
  });

  test("a partner's last updated covers its sections, on the page and in the list", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Sections`, adults: [{ firstName: "Pat" }] },
    });
    const own = await prisma.partner.findUnique({ where: { id: created.body.id } });
    await new Promise((r) => setTimeout(r, 1100));
    const adult = await prisma.adult.findFirst({ where: { partnerId: created.body.id } });
    // Someone else edits a family member (through the section's own route).
    const editorEmail = "last-updated-editor@example.test";
    const password = "LastUpdated123!";
    const editor = await prisma.user.create({
      data: {
        email: editorEmail,
        firstName: "Eddie",
        lastName: "Editor",
        passwordHash: await bcrypt.hash(password, 4),
        role: "editor",
        authProvider: "local",
        active: true,
      },
    });
    extraUsers.push(editor.id);
    const asEditor = await client({ email: editorEmail, password });
    assert.equal(
      (await asEditor(`/api/adults/${adult.id}`, { method: "PUT", body: { lastName: "Smith" } })).status,
      200
    );

    // The partner's own row is unchanged...
    const row = await prisma.partner.findUnique({ where: { id: created.body.id } });
    assert.equal(row.lastEditedAt.getTime(), own.lastEditedAt.getTime());
    // ...but the page and the list say who last changed anything on it.
    const detail = await admin(`/api/partners/${created.body.id}`);
    assert.equal(detail.body.lastEditedByName, "Eddie Editor");
    assert.ok(new Date(detail.body.lastEditedAt) > own.lastEditedAt);
    const list = await admin("/api/partners");
    const listed = list.body.find((p) => p.id === created.body.id);
    assert.equal(listed.lastUpdatedByName, "Eddie Editor");
    assert.ok(new Date(listed.lastUpdatedAt) > own.lastEditedAt);
    // A partner nobody has touched through the app has no date.
    const untouched = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Untouched` },
    });
    const none = (await admin("/api/partners")).body.find((p) => p.id === untouched.id);
    assert.equal(none.lastUpdatedAt, null);
  });

  test("a trip's last updated covers its meetings, and a guest's lists carry no editor names", async () => {
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { name: `${FIXTURE_TAG} Trip dates`, status: "planning" },
    });
    assert.equal(trip.status, 201, JSON.stringify(trip.body));
    const own = await prisma.trip.findUnique({ where: { id: trip.body.id } });
    await new Promise((r) => setTimeout(r, 1100));
    const meeting = await admin(`/api/trips/${trip.body.id}/meetings`, {
      method: "POST",
      body: { title: "Kickoff", startAt: "2027-01-10T18:00:00.000Z" },
    });
    assert.ok([200, 201].includes(meeting.status), JSON.stringify(meeting.body));
    const detail = await admin(`/api/trips/${trip.body.id}`);
    assert.equal(detail.body.lastEditedByName, "Ada Admin");
    assert.ok(new Date(detail.body.lastEditedAt) > own.lastEditedAt, "the meeting moved the trip's date");
    const listed = (await admin("/api/trips")).body.find((t) => t.id === trip.body.id);
    assert.equal(listed.lastUpdatedByName, "Ada Admin");

    // A guest on this trip sees the trip but no editor names in the list.
    const guestEmail = "last-updated-guest@example.test";
    const guestPassword = "LastUpdatedG123!";
    const guest = await prisma.user.create({
      data: {
        email: guestEmail,
        passwordHash: await bcrypt.hash(guestPassword, 4),
        role: "guest",
        authProvider: "local",
        active: true,
        mfaSetupRequired: false,
      },
    });
    extraUsers.push(guest.id);
    await prisma.tripAccess.create({ data: { userId: guest.id, tripId: trip.body.id } });
    const asGuest = await client({ email: guestEmail, password: guestPassword });
    const guestList = await asGuest("/api/trips");
    assert.equal(guestList.status, 200, JSON.stringify(guestList.body));
    assert.ok(guestList.body.length >= 1);
    assert.ok(!JSON.stringify(guestList.body).includes("lastUpdated"), "no last-updated fields for a guest");
  });
});
