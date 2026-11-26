// The audit trail's database side: nothing is written while the feature is off; an entry keeps
// its who/what after the accounts involved are deleted; a restricted partner's view is logged
// once per person per day; the prune keeps exactly the retention window. Runs against the real
// database.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  recordAudit,
  recordAuditSafe,
  recordRestrictedView,
  pruneAuditLog,
  clearAuditEnabledCache,
} = require("../../src/utils/auditLog");
const { removeFixturePartners, FIXTURE_TAG } = require("./helpers");

let originalSettings;
const createdUsers = [];

async function setSettings({ audit, retention }) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), auditTrail: audit };
  const data = { enabledFeatures, ...(retention ? { auditRetentionDays: retention } : {}) };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  clearAuditEnabledCache();
}

async function makeUser(tag, extra = {}) {
  const user = await prisma.user.create({
    data: {
      email: `audit-test-${tag}-${Date.now()}@example.test`,
      firstName: tag,
      lastName: "Tester",
      passwordHash: "x",
      role: "admin",
      authProvider: "local",
      active: true,
      ...extra,
    },
  });
  createdUsers.push(user.id);
  return user;
}

const rowsFor = (where) => prisma.auditLog.findMany({ where, orderBy: { createdAt: "asc" } });

describe("audit trail", () => {
  before(async () => {
    originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  });
  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await setSettings({ audit: true, retention: 90 });
  });
  after(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await removeFixturePartners();
    if (originalSettings) {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: {
          enabledFeatures: originalSettings.enabledFeatures ?? {},
          auditRetentionDays: originalSettings.auditRetentionDays,
        },
      });
    }
    clearAuditEnabledCache();
    await prisma.$disconnect();
  });

  test("nothing is written while the feature is off", async () => {
    await setSettings({ audit: false });
    const actor = await makeUser("off");
    assert.equal(await recordAudit(null, { action: "user.created", actor }), null);
    assert.equal(await prisma.auditLog.count(), 0);
  });

  test("an entry records the actor, the target and the record, with snapshots", async () => {
    const actor = await makeUser("actor");
    const target = await makeUser("target");
    await recordAudit(null, {
      action: "user.updated",
      actor,
      target,
      entity: { type: "partner", id: "p1", label: "The Smiths" },
      ip: "203.0.113.9",
      details: { role: { from: "viewer", to: "editor" } },
    });
    const [row] = await prisma.auditLog.findMany();
    assert.equal(row.actorUserId, actor.id);
    assert.equal(row.actorEmail, actor.email);
    assert.equal(row.actorName, "actor Tester");
    assert.equal(row.targetUserId, target.id);
    assert.equal(row.targetName, "target Tester");
    assert.equal(row.entityLabel, "The Smiths");
    assert.equal(row.ip, "203.0.113.9");
    assert.deepEqual(row.details, { role: { from: "viewer", to: "editor" } });
  });

  test("the entry still says who after the actor and the target are deleted", async () => {
    const actor = await makeUser("gone-actor");
    const target = await makeUser("gone-target");
    await recordAudit(null, { action: "user.updated", actor, target });
    await prisma.user.deleteMany({ where: { id: { in: [actor.id, target.id] } } });
    const [row] = await prisma.auditLog.findMany();
    assert.equal(row.actorEmail, actor.email);
    assert.equal(row.targetEmail, target.email);
    assert.equal(row.actorUserId, actor.id, "the id is kept so the page can tag it as deleted");
  });

  test("an unauthenticated event (a failed sign-in) has no actor", async () => {
    await recordAudit(null, {
      action: "auth.login_failed",
      target: { email: "someone@example.test" },
      ip: "198.51.100.4",
    });
    const [row] = await prisma.auditLog.findMany();
    assert.equal(row.actorUserId, null);
    assert.equal(row.targetEmail, "someone@example.test");
  });

  test("an unknown action throws; the safe variant swallows a failure", async () => {
    await assert.rejects(recordAudit(null, { action: "nope.nope" }), /Unknown audit action/);
    const quiet = await recordAuditSafe(null, { action: "nope.nope" });
    assert.equal(quiet, null);
  });

  test("a row written inside a transaction rolls back with it", async () => {
    const actor = await makeUser("tx");
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await recordAudit(tx, { action: "user.created", actor });
        throw new Error("boom");
      }),
      /boom/
    );
    assert.equal(await prisma.auditLog.count(), 0);
  });

  test("a restricted partner's view is logged once per person per day", async () => {
    const viewer = await makeUser("viewer");
    const other = await makeUser("viewer2");
    const partner = await prisma.partner.create({
      data: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} Restricted`,
        isRestricted: true,
      },
    });
    const now = new Date();
    await recordRestrictedView({ viewer, partner, now });
    await recordRestrictedView({ viewer, partner, now });
    await recordRestrictedView({ viewer: other, partner, now });
    const rows = await rowsFor({ action: "partner.restricted_viewed", entityId: partner.id });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.actorUserId).sort(), [viewer.id, other.id].sort());
  });

  test("prune keeps exactly the retention window", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date();
    const mk = (days) =>
      prisma.auditLog.create({
        data: { action: "auth.login_success", createdAt: new Date(now.getTime() - days * day) },
      });
    await mk(10);
    await mk(89);
    await mk(91);
    await mk(400);
    assert.deepEqual(await pruneAuditLog({ now }), { deleted: 2, days: 90 });
    assert.equal(await prisma.auditLog.count(), 2);

    await setSettings({ audit: true, retention: 30 });
    assert.deepEqual(await pruneAuditLog({ now }), { deleted: 1, days: 30 });
    assert.equal(await prisma.auditLog.count(), 1);
    assert.deepEqual(await pruneAuditLog({ now }), { deleted: 0, days: 30 }, "idempotent");
  });

  test("the prune runs even while the feature is off", async () => {
    await setSettings({ audit: false });
    await prisma.auditLog.create({
      data: { action: "auth.login_success", createdAt: new Date(Date.now() - 200 * 86400000) },
    });
    assert.equal((await pruneAuditLog()).deleted, 1);
  });
});
