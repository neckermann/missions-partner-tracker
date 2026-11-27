// Who can download a partner's file (a newsletter, a letter, a document). Nobody signed out, nobody on a partner they
// have no reach to, and nobody at all while the Newsletters & Docs feature is off. Mirrors what photos.test.js does
// for photos: the file itself, a private partner's, a restricted partner's, and each kind of login.
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

const BYTES = Buffer.from("%PDF-1.4 a private newsletter");
let admin;
let editor;
let viewer;
let anon;
let guest;
let guestUserId;
let originalFeatures;
const files = {};

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

async function makeFile(label, partnerData) {
  const partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} File access ${label}`, ...partnerData },
  });
  const file = await prisma.partnerFile.create({
    data: {
      partnerId: partner.id,
      kind: "newsletter",
      receivedDate: new Date("2026-03-01"),
      fileName: `${label}.pdf`,
      contentType: "application/pdf",
      fileSize: BYTES.length,
      bytesRow: { create: { bytes: BYTES } },
    },
  });
  return { partnerId: partner.id, fileId: file.id };
}

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, anon] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(null),
  ]);
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ partnerFiles: true, careTeam: true });

  files.publicOne = await makeFile("public", { isPublic: true });
  files.privateOne = await makeFile("private", { isPublic: false });
  files.restricted = await makeFile("restricted", { isPublic: true, isRestricted: true });
  files.other = await makeFile("other", { isPublic: false });

  // A guest login whose only reach is a care team seat on the private partner.
  const email = "route-test-fileaccess-guest@example.test";
  const password = "RouteTestFiles123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role: "guest", active: true },
    create: {
      email,
      firstName: "Files",
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  guestUserId = user.id;
  const team = await admin(`/api/care-team/${files.privateOne.partnerId}`, {
    method: "PUT",
    body: { leadUserId: null, memberUserIds: [user.id] },
  });
  assert.equal(team.status, 200, JSON.stringify(team.body).slice(0, 200));
  guest = await client({ email, password });
});

after(async () => {
  await prisma.careTeamMember.deleteMany({ where: { userId: guestUserId } });
  await prisma.user.deleteMany({ where: { id: guestUserId } });
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

const download = (who, fileId) => who(`/api/partner-files/${fileId}/download`);

describe("GET /api/partner-files/:id/download", () => {
  test("nobody signed out can download any file, whether its partner is public or not", async () => {
    for (const key of ["publicOne", "privateOne", "restricted"]) {
      assert.equal((await download(anon, files[key].fileId)).status, 401, `${key} must need a sign-in`);
    }
  });

  test("admin, editor and viewer can download any partner's file, the stored bytes as a PDF", async () => {
    for (const who of [admin, editor, viewer]) {
      for (const key of ["publicOne", "privateOne", "restricted"]) {
        const res = await download(who, files[key].fileId);
        assert.equal(res.status, 200, key);
        assert.match(res.headers.get("content-type"), /^application\/pdf/);
        assert.equal(Number(res.headers.get("content-length")), BYTES.length);
      }
    }
  });

  test("a guest reaches only the partner they hold a care team seat on", async () => {
    assert.equal((await download(guest, files.privateOne.fileId)).status, 200);
    assert.equal((await download(guest, files.other.fileId)).status, 403);
    assert.equal((await download(guest, files.restricted.fileId)).status, 403);
    assert.equal((await download(guest, files.publicOne.fileId)).status, 403);
  });

  test("an unknown id is a 404", async () => {
    assert.equal((await download(admin, "does-not-exist")).status, 404);
  });

  test("while the feature is off nobody can download, an admin included", async () => {
    await setFeatures({ partnerFiles: false });
    try {
      assert.equal((await download(admin, files.publicOne.fileId)).status, 404);
      assert.equal((await download(guest, files.privateOne.fileId)).status, 404);
    } finally {
      await setFeatures({ partnerFiles: true });
    }
    assert.equal((await download(admin, files.publicOne.fileId)).status, 200);
  });
});
