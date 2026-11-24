// The activity trail end to end (#341): the real routes write the entries the
// Activity page will read. Covers sign-in (success and failure, never leaking a
// reason to the caller), account changes, trip access, care teams, settings
// (secrets noted as changed, never stored), feature toggles, partner/trip
// deletes, backups and restricted-partner views.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { clearAuditEnabledCache } = require("../../src/utils/auditLog");
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
let originalSettings;
const cleanupUsers = [];
const cleanupTrips = [];

async function setAudit(on) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = {
    ...(current?.enabledFeatures || {}),
    auditTrail: on,
    trips: true,
    careTeam: true,
  };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
  clearAuditEnabledCache();
}
const log = (where = {}) => prisma.auditLog.findMany({ where, orderBy: { createdAt: "asc" } });
const wait = () => new Promise((r) => setTimeout(r, 150)); // settings audit runs on response finish

describe("activity trail events", () => {
  before(async () => {
    await ensureTestUsers();
    originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await setAudit(true);
    admin = await client("admin");
    adminRow = await prisma.user.findUnique({ where: { email: "route-test-admin@example.test" } });
  });
  beforeEach(async () => {
    await setAudit(true);
    await prisma.auditLog.deleteMany({});
  });
  after(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: cleanupUsers } } });
    await prisma.trip.deleteMany({ where: { id: { in: cleanupTrips } } });
    await removeFixturePartners();
    if (originalSettings) {
      await prisma.churchSettings.update({
        where: { id: "singleton" },
        data: {
          enabledFeatures: originalSettings.enabledFeatures ?? {},
          anthropicApiKey: originalSettings.anthropicApiKey,
        },
      });
    }
    clearAuditEnabledCache();
    await removeTestUsers();
    await stopServer();
  });

  test("a wrong password is logged with the reason, and the caller learns nothing", async () => {
    const anon = await client();
    const res = await anon("/api/auth/login", {
      method: "POST",
      body: { email: "route-test-admin@example.test", password: "wrong-password" },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: "Invalid credentials" });
    const [row] = await log({ action: "auth.login_failed" });
    assert.equal(row.targetEmail, "route-test-admin@example.test");
    assert.equal(row.actorUserId, null);
    assert.deepEqual(row.details, { reason: "wrong_password" });
    assert.ok(row.ip);
  });

  test("an email with no account is logged by the address tried", async () => {
    const anon = await client();
    await anon("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@example.test", password: "whatever-123" },
    });
    const [row] = await log({ action: "auth.login_failed" });
    assert.equal(row.targetEmail, "nobody@example.test");
    assert.equal(row.targetUserId, null);
    assert.deepEqual(row.details, { reason: "unknown_email" });
  });

  test("a successful sign-in is logged with the person's name", async () => {
    await client("admin");
    const rows = await log({ action: "auth.login_success", actorEmail: "route-test-admin@example.test" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actorUserId, adminRow.id);
  });

  test("creating, changing and deleting an account are each logged, with old and new values", async () => {
    const created = await admin("/api/users", {
      method: "POST",
      body: {
        email: "audit-route-user@example.test",
        role: "viewer",
        sendWelcomeEmail: false,
        password: "AuditRoute123!",
      },
    });
    assert.equal(created.status, 201);
    cleanupUsers.push(created.body.id);

    await admin(`/api/users/${created.body.id}`, {
      method: "PUT",
      body: { role: "editor", firstName: "Aud" },
    });
    await admin(`/api/users/${created.body.id}`, { method: "DELETE" });

    const rows = await log({ targetUserId: created.body.id });
    assert.deepEqual(
      rows.map((r) => r.action),
      ["user.created", "user.updated", "user.deleted"]
    );
    assert.equal(rows[0].actorUserId, adminRow.id);
    assert.equal(rows[0].actorName ?? "", adminRow.firstName ? `${adminRow.firstName}` : "");
    assert.deepEqual(rows[1].details, {
      firstName: { from: null, to: "Aud" },
      role: { from: "viewer", to: "editor" },
    });
    // the deleted account is still named in its own history
    assert.equal(rows[2].targetEmail, "audit-route-user@example.test");
  });

  test("an admin password reset is noted without the password", async () => {
    const created = await admin("/api/users", {
      method: "POST",
      body: {
        email: "audit-route-pw@example.test",
        role: "viewer",
        sendWelcomeEmail: false,
        password: "AuditRoute123!",
      },
    });
    cleanupUsers.push(created.body.id);
    await prisma.auditLog.deleteMany({});
    await admin(`/api/users/${created.body.id}`, { method: "PUT", body: { password: "BrandNewPass456!" } });
    const [row] = await log({ action: "user.updated" });
    assert.deepEqual(row.details, { password: "reset by an admin" });
    assert.ok(!JSON.stringify(row).includes("BrandNewPass456"));
  });

  test("guest trip access: grant, extend, revoke and the resulting deactivation", async () => {
    const trip = await prisma.trip.create({
      data: { name: `${FIXTURE_TAG} Audit trip`, status: "recruiting" },
    });
    cleanupTrips.push(trip.id);
    const guest = await admin("/api/users", {
      method: "POST",
      body: {
        email: "audit-route-guest@example.test",
        role: "guest",
        sendWelcomeEmail: false,
        password: "AuditRoute123!",
        tripAccess: [{ tripId: trip.id }],
      },
    });
    assert.equal(guest.status, 201, JSON.stringify(guest.body));
    cleanupUsers.push(guest.body.id);
    await admin(`/api/users/${guest.body.id}/trip-access/${trip.id}`, {
      method: "PUT",
      body: { expiresAt: "2099-01-01" },
    });
    await admin(`/api/users/${guest.body.id}/trip-access/${trip.id}`, { method: "DELETE" });
    const rows = await log({ targetUserId: guest.body.id });
    assert.deepEqual(
      rows.map((r) => r.action),
      [
        "user.created",
        "trip_access.grant",
        "trip_access.update",
        "trip_access.revoke",
        "guest.deactivate_no_access",
      ]
    );
    assert.equal(rows[1].entityLabel, `${FIXTURE_TAG} Audit trip`);
  });

  test("a care team edit is one entry naming who joined, left and led", async () => {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Care audit` },
    });
    const a = await prisma.user.create({
      data: {
        email: "audit-care-a@example.test",
        firstName: "Ann",
        passwordHash: "x",
        role: "editor",
        authProvider: "local",
      },
    });
    cleanupUsers.push(a.id);
    const res = await admin(`/api/care-team/${partner.id}`, {
      method: "PUT",
      body: { leadUserId: a.id, memberUserIds: [] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [row] = await log({ action: "care_team.updated" });
    assert.equal(row.entityLabel, `${FIXTURE_TAG} Care audit`);
    assert.deepEqual(row.details, { added: ["Ann"], lead: { from: null, to: "Ann" } });
  });

  test("an API key change is logged as changed; its value is never stored", async () => {
    const res = await admin("/api/settings/ai-extraction", {
      method: "PUT",
      body: { apiKey: "sk-ant-super-secret-value" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await wait();
    const rows = await log({ action: "settings.updated" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entityLabel, "ai-extraction");
    assert.equal(rows[0].details.anthropicApiKey, "changed");
    assert.ok(!JSON.stringify(rows).includes("sk-ant-super-secret-value"));
  });

  test("turning a feature on or off is its own entry, with the feature's name", async () => {
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    const res = await admin("/api/settings", {
      method: "PUT",
      body: { enabledFeatures: { ...current.enabledFeatures, reports: false } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await wait();
    const rows = await log({ action: "settings.feature_toggled" });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].details, { feature: "reports", from: true, to: false });
  });

  test("switching the activity log off records the switch-off, then goes quiet", async () => {
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    await admin("/api/settings", {
      method: "PUT",
      body: { enabledFeatures: { ...current.enabledFeatures, auditTrail: false } },
    });
    await wait();
    const rows = await log({ action: "settings.feature_toggled" });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].details, { feature: "auditTrail", from: true, to: false });
    await admin("/api/settings", { method: "PUT", body: { churchName: "Changed While Off" } });
    await wait();
    assert.equal((await log({ action: "settings.updated" })).length, 0);
  });

  test("deleting a partner and a trip are logged with their names", async () => {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} To delete`, archived: true },
    });
    const trip = await prisma.trip.create({
      data: { name: `${FIXTURE_TAG} Trip to delete`, status: "recruiting" },
    });
    assert.equal((await admin(`/api/partners/${partner.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await admin(`/api/trips/${trip.id}`, { method: "DELETE" })).status, 204);
    const [p] = await log({ action: "partner.deleted" });
    const [t] = await log({ action: "trip.deleted" });
    assert.equal(p.entityLabel, `${FIXTURE_TAG} To delete`);
    assert.equal(t.entityLabel, `${FIXTURE_TAG} Trip to delete`);
    assert.equal(p.actorUserId, adminRow.id);
  });

  test("a backup download is logged", async () => {
    assert.equal((await admin("/api/backups/download")).status, 200);
    assert.equal((await log({ action: "backup.downloaded" })).length, 1);
  });

  test("restricting a partner is logged, and viewing one is logged once a day", async () => {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Sensitive` },
    });
    await admin(`/api/partners/${partner.id}`, { method: "PUT", body: { isRestricted: true } });
    const [changed] = await log({ action: "partner.restricted_changed" });
    assert.deepEqual(changed.details, { isRestricted: { from: false, to: true } });

    await admin(`/api/partners/${partner.id}`);
    await admin(`/api/partners/${partner.id}`);
    assert.equal((await log({ action: "partner.restricted_viewed" })).length, 1);

    const open = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Ordinary` },
    });
    await admin(`/api/partners/${open.id}`);
    assert.equal((await log({ action: "partner.restricted_viewed", entityId: open.id })).length, 0);
  });

  test("nothing at all is written while the feature is off", async () => {
    await setAudit(false);
    await client("admin");
    const anon = await client();
    await anon("/api/auth/login", {
      method: "POST",
      body: { email: "x@example.test", password: "nope-nope" },
    });
    assert.equal(await prisma.auditLog.count(), 0);
  });
});
