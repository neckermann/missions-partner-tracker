// The Audit log page's API (#341): admin-only and flag-gated, filters and
// paging, deleted accounts flagged, the CSV export (formula-safe, same filters),
// and the retention setting.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { clearAuditEnabledCache } = require("../../src/utils/auditLog");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let editor;
let originalSettings;
const day = 24 * 60 * 60 * 1000;

async function setFlag(on) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), auditTrail: on };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
  clearAuditEnabledCache();
}
const entry = (data, daysAgo = 0) =>
  prisma.auditLog.create({ data: { createdAt: new Date(Date.now() - daysAgo * day), ...data } });

describe("audit log API", () => {
  before(async () => {
    await ensureTestUsers();
    originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await setFlag(true);
    admin = await client("admin");
    editor = await client("editor");
  });
  beforeEach(async () => {
    await setFlag(true);
    await prisma.auditLog.deleteMany({});
  });
  after(async () => {
    await prisma.auditLog.deleteMany({});
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
    await removeTestUsers();
    await stopServer();
  });

  test("only an admin can read it, and only while the feature is on", async () => {
    assert.equal((await editor("/api/audit")).status, 403);
    assert.equal((await (await client())("/api/audit")).status, 401);
    await setFlag(false);
    assert.equal((await admin("/api/audit")).status, 404);
    assert.equal((await admin("/api/audit/export")).status, 404);
  });

  test("lists newest first with the action's label and category", async () => {
    await entry({ action: "auth.login_success", actorEmail: "a@example.test", actorName: "Ann" }, 3);
    await entry(
      { action: "user.deleted", actorEmail: "b@example.test", targetEmail: "gone@example.test" },
      1
    );
    const { body } = await admin("/api/audit");
    assert.deepEqual(
      body.rows.map((r) => r.action),
      ["user.deleted", "auth.login_success"]
    );
    assert.equal(body.rows[0].label, "Deleted an account");
    assert.equal(body.rows[0].category, "Accounts");
    assert.equal(body.nextCursor, null);
  });

  test("filters by category, action, text and date", async () => {
    await entry({ action: "auth.login_failed", targetEmail: "x@example.test", ip: "203.0.113.7" }, 10);
    await entry({ action: "auth.login_success", actorEmail: "dana@example.test", actorName: "Dana W" }, 5);
    await entry({ action: "backup.downloaded", actorEmail: "dana@example.test", actorName: "Dana W" }, 1);
    const get = async (qs) => (await admin(`/api/audit?${qs}`)).body.rows.map((r) => r.action);
    assert.deepEqual(await get("category=Sign-in"), ["auth.login_success", "auth.login_failed"]);
    assert.deepEqual(await get("action=backup.downloaded"), ["backup.downloaded"]);
    assert.deepEqual((await get("q=dana")).sort(), ["auth.login_success", "backup.downloaded"]);
    assert.deepEqual(await get("q=203.0.113"), ["auth.login_failed"]);
    const iso = (n) => new Date(Date.now() - n * day).toISOString().slice(0, 10);
    assert.deepEqual(await get(`from=${iso(6)}`), ["backup.downloaded", "auth.login_success"]);
    assert.deepEqual(await get(`to=${iso(6)}`), ["auth.login_failed"]);
    assert.equal((await admin("/api/audit?from=not-a-date")).status, 400);
  });

  test("blank filters, as the page's empty form sends them, mean no filter", async () => {
    await entry({ action: "auth.login_success", actorEmail: "a@example.test" });
    const res = await admin("/api/audit?q=&category=&action=&from=&to=");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rows.length, 1);
    assert.equal((await admin("/api/audit/export?q=&category=&from=&to=")).status, 200);
  });

  test("pages with a cursor until the end", async () => {
    for (let i = 0; i < 5; i++)
      await entry({ action: "auth.login_success", actorEmail: `u${i}@example.test` }, i);
    const first = await admin("/api/audit?limit=2");
    assert.equal(first.body.rows.length, 2);
    assert.ok(first.body.nextCursor);
    const second = await admin(`/api/audit?limit=2&cursor=${first.body.nextCursor}`);
    const third = await admin(`/api/audit?limit=2&cursor=${second.body.nextCursor}`);
    assert.equal(third.body.rows.length, 1);
    assert.equal(third.body.nextCursor, null);
    const all = [...first.body.rows, ...second.body.rows, ...third.body.rows].map((r) => r.actor.email);
    assert.deepEqual(all, [
      "u0@example.test",
      "u1@example.test",
      "u2@example.test",
      "u3@example.test",
      "u4@example.test",
    ]);
  });

  test("a deleted account is flagged but still named", async () => {
    const live = await prisma.user.findUnique({ where: { email: "route-test-admin@example.test" } });
    await entry({
      action: "user.updated",
      actorUserId: live.id,
      actorEmail: live.email,
      targetUserId: "00000000-0000-0000-0000-00000000dead",
      targetEmail: "ghost@example.test",
      targetName: "Gus Ghost",
      details: { role: { from: "viewer", to: "editor" } },
    });
    const [row] = (await admin("/api/audit")).body.rows;
    assert.equal(row.actor.deleted, false);
    assert.equal(row.target.deleted, true);
    assert.equal(row.target.name, "Gus Ghost");
    assert.equal(row.summary, "Role: viewer → editor");
  });

  test("the CSV has the same rows, readable details, and neutralises formulas", async () => {
    await entry({
      action: "settings.updated",
      actorEmail: "dana@example.test",
      actorName: '=HYPERLINK("http://evil.example")',
      entityType: "settings",
      entityLabel: "email",
      details: { postmarkServerToken: "changed" },
      ip: "203.0.113.9",
    });
    const res = await admin("/api/audit/export?category=Settings");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), /activity-log/);
    assert.ok(res.body.includes("When (UTC),Who,Who (email),What"));
    assert.ok(res.body.includes("Changed church settings"));
    assert.ok(res.body.includes("Postmark server token: changed"));
    assert.ok(res.body.includes("203.0.113.9"));
    assert.ok(!res.body.includes(",=HYPERLINK"), "a leading = must be neutralised");
    assert.equal(
      (await admin("/api/audit/export?category=Sign-in")).body.split("\r\n").filter(Boolean).length,
      1,
      "header only"
    );
  });

  test("meta lists the filters and the retention window", async () => {
    await entry({ action: "auth.login_success" }, 4);
    const { body } = await admin("/api/audit/meta");
    assert.ok(body.categories.includes("Sign-in"));
    assert.ok(body.actions.some((a) => a.code === "user.deleted"));
    assert.deepEqual(body.retentionChoices, [30, 60, 90]);
    assert.equal(body.total, 1);
    assert.ok(body.oldest);
  });

  test("retention: 30, 60 or 90 only, and changing it is itself logged", async () => {
    assert.equal((await admin("/api/audit/retention", { method: "PUT", body: { days: 45 } })).status, 400);
    assert.equal((await editor("/api/audit/retention", { method: "PUT", body: { days: 30 } })).status, 403);
    const ok = await admin("/api/audit/retention", { method: "PUT", body: { days: 30 } });
    assert.deepEqual(ok.body, { retentionDays: 30 });
    assert.equal((await admin("/api/audit/meta")).body.retentionDays, 30);
    const [row] = (await admin("/api/audit?category=Settings")).body.rows;
    assert.equal(row.summary, "Retention days: 90 → 30");
  });
});
