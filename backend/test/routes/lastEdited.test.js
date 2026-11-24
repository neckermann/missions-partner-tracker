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
const extraUsers = [];

describe("last edited by", () => {
  before(async () => {
    await ensureTestUsers();
    await prisma.user.updateMany({
      where: { email: "route-test-admin@example.test" },
      data: { firstName: "Ada", lastName: "Admin" },
    });
    admin = await client("admin");
    adminRow = await prisma.user.findUnique({ where: { email: "route-test-admin@example.test" } });
  });
  after(async () => {
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
});
