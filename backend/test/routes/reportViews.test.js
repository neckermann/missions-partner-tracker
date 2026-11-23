// Saved report views + scheduled emails (#298) -- the PR that built this
// never ran it against a real Postgres either (same "no Prisma client in
// the cloud workspace" gap as #297's own reports.js, see that PR's own
// description). This is that verification for the view/schedule routes
// specifically (reports.test.js covers the report queries themselves).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_USERS } = require("./helpers");

let admin;
let editor;
let viewer;
let editorId;

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

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  const editorRow = await prisma.user.findUnique({ where: { email: TEST_USERS.editor.email } });
  editorId = editorRow.id;
  await setFeatures({ reports: true, prayerRequests: true });
});

after(async () => {
  await prisma.reportSchedule.deleteMany({});
  await prisma.savedReport.deleteMany({});
  await removeTestUsers();
  await stopServer();
});

describe("Saved report views", () => {
  test("creating a view validates its params against the report's own schema", async () => {
    const bad = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "Bad params", params: { status: "not-a-real-status" } },
    });
    assert.equal(bad.status, 400);

    const ok = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "Open prayer requests", params: { status: "open" } },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.ownerId, editorId);
    assert.equal(ok.body.shared, false);
  });

  test("a private view is only visible to its owner (or an admin); a shared one is visible to everyone", async () => {
    const mine = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "Editor's private view", params: {} },
    });
    const sharedView = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "Editor's shared view", params: {}, shared: true },
    });
    assert.equal(mine.status, 201);
    assert.equal(sharedView.status, 201);

    const viewerList = await viewer("/api/reports/views?reportId=prayer-requests");
    const viewerNames = viewerList.body.map((v) => v.name);
    assert.ok(!viewerNames.includes("Editor's private view"), "a private view stays hidden from other users");
    assert.ok(viewerNames.includes("Editor's shared view"), "a shared view is visible to everyone");

    // GET /views deliberately never surfaces someone else's private view,
    // admin included -- these are personal saved filters, not church data
    // (see ownView() below for the separate, broader admin-can-manage-any-
    // view permission that still applies to delete/schedule by direct id).
    const adminList = await admin("/api/reports/views?reportId=prayer-requests");
    assert.ok(!adminList.body.map((v) => v.name).includes("Editor's private view"));
  });

  test("deleting someone else's private view 404s for a non-owner, non-admin caller", async () => {
    const created = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "To delete", params: {} },
    });
    const deniedDelete = await viewer(`/api/reports/views/${created.body.id}`, { method: "DELETE" });
    assert.equal(deniedDelete.status, 404);

    const ownDelete = await editor(`/api/reports/views/${created.body.id}`, { method: "DELETE" });
    assert.equal(ownDelete.status, 204);
  });
});

describe("Report schedules", () => {
  test("only an admin can schedule a view", async () => {
    const view = await editor("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "Weekly digest", params: {} },
    });
    const deniedSchedule = await editor(`/api/reports/views/${view.body.id}/schedule`, {
      method: "POST",
      body: { cadence: "weekly", recipientIds: [editorId] },
    });
    assert.equal(deniedSchedule.status, 403);

    const created = await admin(`/api/reports/views/${view.body.id}/schedule`, {
      method: "POST",
      body: { cadence: "weekly", recipientIds: [editorId] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.savedReportId, view.body.id);

    const deniedScheduleDelete = await editor(`/api/reports/schedules/${created.body.id}`, {
      method: "DELETE",
    });
    assert.equal(deniedScheduleDelete.status, 403);

    const deletedSchedule = await admin(`/api/reports/schedules/${created.body.id}`, { method: "DELETE" });
    assert.equal(deletedSchedule.status, 204);
  });

  test("a recipient that isn't an existing active user is rejected -- never a free-form address", async () => {
    const view = await admin("/api/reports/views", {
      method: "POST",
      body: { reportId: "prayer-requests", name: "For recipient check", params: {}, shared: true },
    });
    const res = await admin(`/api/reports/views/${view.body.id}/schedule`, {
      method: "POST",
      body: { cadence: "monthly", recipientIds: ["not-a-real-user-id"] },
    });
    assert.equal(res.status, 400);
  });
});
