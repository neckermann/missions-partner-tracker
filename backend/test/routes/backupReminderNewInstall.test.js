// The backup banner (and the bell's "Time to check your backups") is held back on a brand-new install's first
// days, then appears as before. Dismissing it still snoozes it.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers, cleanupRow } = require("./helpers");

let admin;
let originalCreatedAt;
let originalBackupFlag;
const DAY = 24 * 60 * 60 * 1000;

const showing = async () => {
  const res = await admin("/api/notifications/summary");
  assert.equal(res.status, 200);
  return (res.body.categories.find((c) => c.key === "timeToCheckBackups")?.count ?? 0) > 0;
};
const setInstallAge = (days) =>
  prisma.user.updateMany({ data: { createdAt: new Date(Date.now() - days * DAY) } });

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalCreatedAt = await prisma.user.findMany({ select: { id: true, createdAt: true } });
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { backupReminderDisabled: true },
  });
  originalBackupFlag = settings?.backupReminderDisabled ?? false;
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { backupReminderDisabled: false } });
  await prisma.notificationSeen.deleteMany({ where: { category: "timeToCheckBackups" } });
});

after(async () => {
  await Promise.all(
    originalCreatedAt.map((u) =>
      cleanupRow(prisma.user.update({ where: { id: u.id }, data: { createdAt: u.createdAt } }))
    )
  );
  await prisma.notificationSeen.deleteMany({ where: { category: "timeToCheckBackups" } });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { backupReminderDisabled: originalBackupFlag },
  });
  await removeTestUsers();
  await stopServer();
});

describe("the backup reminder on a brand-new install", () => {
  test("is not shown while the first account is under three days old", async () => {
    await setInstallAge(0);
    assert.equal(await showing(), false);
    await setInstallAge(2);
    assert.equal(await showing(), false);
  });

  test("appears once the install is older, as it always has", async () => {
    await setInstallAge(4);
    assert.equal(await showing(), true);
  });

  test("dismissing it still snoozes it, and a long-running install is unaffected", async () => {
    await setInstallAge(400);
    assert.equal(await showing(), true);
    await admin("/api/notifications/seen", { method: "POST", body: { category: "timeToCheckBackups" } });
    assert.equal(await showing(), false, "snoozed for 30 days after being dismissed");
  });
});
