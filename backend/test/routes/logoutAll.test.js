// "Sign out of all devices" ends every open session of the account, this one included, and nobody else's.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { clearAuditEnabledCache } = require("../../src/utils/auditLog");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let phone; // the same account signed in on a second device
let laptop;
let other; // a different account
let anon;
let originalFeatures;

before(async () => {
  await ensureTestUsers();
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = current?.enabledFeatures ?? {};
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: { ...originalFeatures, auditTrail: true } },
    create: { id: "singleton", enabledFeatures: { auditTrail: true } },
  });
  clearAuditEnabledCache();
  [phone, laptop, other, anon] = await Promise.all([
    client("editor"),
    client("editor"),
    client("admin"),
    client(null),
  ]);
});

after(async () => {
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  clearAuditEnabledCache();
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/auth/logout-all", () => {
  test("needs a signed-in session", async () => {
    assert.equal((await anon("/api/auth/logout-all", { method: "POST" })).status, 401);
  });

  test("ends every session of the account (both devices), and clears this browser's cookie", async () => {
    assert.equal((await phone("/api/auth/me")).status, 200);
    assert.equal((await laptop("/api/auth/me")).status, 200);

    const res = await laptop("/api/auth/logout-all", { method: "POST" });
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("set-cookie") || "",
      /Max-Age=0|Expires=/i,
      "this browser's cookie is cleared"
    );

    assert.equal((await phone("/api/auth/me")).status, 401, "the other device is signed out");
    assert.equal((await laptop("/api/auth/me")).status, 401, "and so is this one");
  });

  test("does not touch anyone else's sessions, and signing in again works", async () => {
    assert.equal((await other("/api/auth/me")).status, 200);
    const again = await client("editor");
    assert.equal((await again("/api/auth/me")).status, 200);
  });

  test("is written to the audit log", async () => {
    const session = await client("editor");
    await session("/api/auth/logout-all", { method: "POST" });
    const entry = await prisma.auditLog.findFirst({
      where: { action: "auth.logout_all" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(entry, "an audit entry for the sign-out");
  });
});
