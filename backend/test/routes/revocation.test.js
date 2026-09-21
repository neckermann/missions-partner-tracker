const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
// Explicit rather than relying on ./helpers being required first --
// prismaClient reads DATABASE_URL at construction, so importing it before
// something has loaded .env fails with an opaque SASL error.
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  client,
  startServer,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  TEST_PASSWORD,
} = require("./helpers");

// helpers.client() only knows the three fixture roles. This logs in as an
// arbitrary account so the delete case can use a throwaway user.
async function loginAs(email, password) {
  const base = await startServer();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login as ${email} failed: ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (path) => {
    const r = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status };
  };
}

// Revoking access has to mean something immediately.
//
// The session is a stateless 8-hour JWT that carries the user's role in its
// claims, and requireAuth used to trust those claims without ever consulting
// the database. So deactivating an account, deleting it, or demoting an
// admin to viewer changed nothing until the token expired -- a volunteer
// whose access was pulled kept it for the rest of the working day, and
// logging out only cleared the cookie while the token stayed valid.
//
// These tests hold the session cookie fixed and change the database
// underneath it, which is exactly the scenario that used to fail.

let editor;
let editorId;

before(async () => {
  await ensureTestUsers();
  editor = await client("editor");
  const row = await prisma.user.findUnique({ where: { email: "route-test-editor@example.test" } });
  editorId = row.id;
});

after(async () => {
  // ensureTestUsers resets role/active, but leave the row sane regardless.
  await prisma.user.update({ where: { id: editorId }, data: { active: true, role: "editor" } });
  await removeTestUsers();
  await stopServer();
});

describe("session revocation", () => {
  test("deactivating an account ends its existing session immediately", async () => {
    assert.equal((await editor("/api/partners")).status, 200, "precondition: the session works");

    await prisma.user.update({ where: { id: editorId }, data: { active: false } });
    try {
      // Same cookie, no re-login.
      assert.equal((await editor("/api/partners")).status, 401);
      assert.equal((await editor("/api/auth/me")).status, 401, "/me must not report who they are either");
    } finally {
      await prisma.user.update({ where: { id: editorId }, data: { active: true } });
    }

    assert.equal((await editor("/api/partners")).status, 200, "reactivating restores it");
  });

  test("demoting a role takes effect without re-login", async () => {
    // An editor may create a partner; a viewer may not.
    const body = { kind: "missionary", displayName: "[route-test] revocation probe" };
    const created = await editor("/api/partners", { method: "POST", body });
    assert.equal(created.status, 201, "precondition: editor can write");

    await prisma.user.update({ where: { id: editorId }, data: { role: "viewer" } });
    try {
      const blocked = await editor("/api/partners", { method: "POST", body });
      assert.equal(blocked.status, 403, "the role in the token must not be what's trusted");
      assert.equal((await editor("/api/partners")).status, 200, "reads still fine as a viewer");
    } finally {
      await prisma.user.update({ where: { id: editorId }, data: { role: "editor" } });
      await prisma.partner.delete({ where: { id: created.body.id } }).catch(() => {});
    }
  });

  test("deleting the account ends the session", async () => {
    // Reuse the editor fixture's hash so this account's password is the
    // known TEST_PASSWORD without hashing a second time.
    const { passwordHash } = await prisma.user.findUnique({ where: { id: editorId } });
    const throwaway = await prisma.user.create({
      data: {
        email: "route-test-throwaway@example.test",
        passwordHash,
        role: "editor",
        active: true,
        authProvider: "local",
      },
    });

    try {
      const doomed = await loginAs(throwaway.email, TEST_PASSWORD);
      assert.equal((await doomed("/api/partners")).status, 200, "precondition: the session works");

      await prisma.user.delete({ where: { id: throwaway.id } });

      // Same cookie, and the token is still cryptographically valid -- the
      // account behind it simply isn't there any more.
      assert.equal((await doomed("/api/partners")).status, 401);
    } finally {
      await prisma.user.deleteMany({ where: { email: throwaway.email } });
    }
  });
});
