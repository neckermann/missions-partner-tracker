// A person added to the missions team starts on the church's default digest tier, covering the partners they look
// after: only if the church has set a default, the tier is offered, and they have no digest yet.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_USERS } = require("./helpers");

let admin;
let editorId;
let original;

const setDefaults = (data) => prisma.churchSettings.update({ where: { id: "singleton" }, data });
const editorRow = () => prisma.user.findUnique({ where: { id: editorId } });
const setTeam = (userIds) => admin("/api/partner-care/missions-team", { method: "PUT", body: { userIds } });

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editorId = (await prisma.user.findUnique({ where: { email: TEST_USERS.editor.email } })).id;
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      defaultDigestCadence: true,
      cadenceBiweeklyEnabled: true,
      cadenceMonthlyEnabled: true,
      cadenceQuarterlyEnabled: true,
    },
  });
});

beforeEach(async () => {
  await prisma.user.update({
    where: { id: editorId },
    data: { onMissionsTeam: false, cadence: null, digestScope: "all" },
  });
  await setDefaults({ defaultDigestCadence: "monthly", cadenceMonthlyEnabled: true });
});

after(async () => {
  await setDefaults(original);
  await removeTestUsers();
  await stopServer();
});

describe("the default digest for new missions team members", () => {
  test("someone newly on the team starts on the default tier, covering the partners they look after", async () => {
    assert.equal((await setTeam([editorId])).status, 200);
    const row = await editorRow();
    assert.equal(row.cadence, "monthly");
    assert.equal(row.digestScope, "owned");
  });

  test("it never changes a digest someone already has, and does nothing when no default is set", async () => {
    await prisma.user.update({
      where: { id: editorId },
      data: { cadence: "quarterly", digestScope: "followed" },
    });
    await setTeam([editorId]);
    let row = await editorRow();
    assert.equal(row.cadence, "quarterly", "their own choice is kept");
    assert.equal(row.digestScope, "followed");

    await prisma.user.update({
      where: { id: editorId },
      data: { cadence: null, digestScope: "all", onMissionsTeam: false },
    });
    await setDefaults({ defaultDigestCadence: null });
    await setTeam([editorId]);
    row = await editorRow();
    assert.equal(row.cadence, null);
  });

  test("a tier the church no longer offers isn't used", async () => {
    await setDefaults({ defaultDigestCadence: "biweekly", cadenceBiweeklyEnabled: false });
    await setTeam([editorId]);
    assert.equal((await editorRow()).cadence, null);
    await setDefaults({ cadenceBiweeklyEnabled: original.cadenceBiweeklyEnabled });
  });

  test("marking a user on the team, or creating them there, subscribes them too", async () => {
    const res = await admin(`/api/users/${editorId}`, { method: "PUT", body: { onMissionsTeam: true } });
    assert.equal(res.status, 200);
    assert.equal((await editorRow()).cadence, "monthly");

    const email = `digest-default-${Date.now()}@example.test`;
    const created = await admin("/api/users", {
      method: "POST",
      body: { email, role: "viewer", password: "DigestDefault123!", onMissionsTeam: true },
    });
    try {
      assert.equal(created.status, 201);
      const row = await prisma.user.findUnique({ where: { email } });
      assert.equal(row.cadence, "monthly");
      assert.equal(row.digestScope, "owned");
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("the default is set through the church settings, and only a real tier is accepted", async () => {
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { defaultDigestCadence: "quarterly" } })).status,
      200
    );
    assert.equal(
      (await prisma.churchSettings.findUnique({ where: { id: "singleton" } })).defaultDigestCadence,
      "quarterly"
    );
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { defaultDigestCadence: "daily" } })).status,
      400
    );
  });
});
