// #327 Finding 11.5 -- four different places set a password
// (self-service change-password, the welcome-link completion, and an
// admin create/reset via users.js; /api/auth/setup is the fourth but
// can't be exercised here since it only succeeds against an empty User
// table) each grew its own length check independently, two of them with
// no upper bound at all. Now all four import the same
// utils/password.js passwordSchema (8-128 chars) -- this covers the
// shared schema directly, plus the three HTTP paths that can run
// against this suite's normal seeded fixtures.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { passwordSchema } = require("../../src/utils/password");
const { issueSetupToken } = require("../../src/utils/passwordSetup");
const { client, stopServer, ensureTestUsers, removeTestUsers, TEST_PASSWORD } = require("./helpers");

describe("passwordSchema (shared by every password-setting route)", () => {
  test("accepts 8-128 characters", () => {
    assert.ok(passwordSchema.safeParse("a".repeat(8)).success);
    assert.ok(passwordSchema.safeParse("a".repeat(128)).success);
  });

  test("rejects under 8 and over 128 characters", () => {
    assert.ok(!passwordSchema.safeParse("a".repeat(7)).success);
    assert.ok(!passwordSchema.safeParse("a".repeat(129)).success);
  });
});

let admin;
let editor;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/auth/change-password -- length enforced both ways", () => {
  test("a too-short new password is rejected", async () => {
    const res = await editor("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: TEST_PASSWORD, newPassword: "short1" },
    });
    assert.equal(res.status, 400);
  });

  test("a too-long (129-char) new password is rejected -- previously had no upper bound at all", async () => {
    const res = await editor("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: TEST_PASSWORD, newPassword: "a".repeat(129) },
    });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/auth/password-setup/complete -- length enforced both ways", () => {
  let pendingUser;

  before(async () => {
    pendingUser = await prisma.user.create({
      data: {
        email: "route-test-password-length-setup@example.test",
        passwordHash: null,
        role: "editor",
        active: true,
        authProvider: "local",
      },
    });
  });

  after(async () => {
    await prisma.passwordSetupToken.deleteMany({ where: { userId: pendingUser.id } });
    await prisma.user.deleteMany({ where: { id: pendingUser.id } });
  });

  test("a too-short password is rejected", async () => {
    const { token } = await issueSetupToken(pendingUser);
    const anon = await client(null);
    const res = await anon("/api/auth/password-setup/complete", {
      method: "POST",
      body: { token, password: "short1" },
    });
    assert.equal(res.status, 400);
  });

  test("a too-long (129-char) password is rejected", async () => {
    const { token } = await issueSetupToken(pendingUser);
    const anon = await client(null);
    const res = await anon("/api/auth/password-setup/complete", {
      method: "POST",
      body: { token, password: "a".repeat(129) },
    });
    assert.equal(res.status, 400);
  });
});

describe("POST/PUT /api/users -- admin-set password length enforced both ways", () => {
  let createdUserId;

  after(async () => {
    if (createdUserId) await prisma.user.deleteMany({ where: { id: createdUserId } });
  });

  test("creating a user with a too-long (129-char) password is rejected -- previously unbounded", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-password-length-create@example.test",
        password: "a".repeat(129),
        sendWelcomeEmail: false,
      },
    });
    assert.equal(res.status, 400);
  });

  test("creating a user with a valid-length password succeeds", async () => {
    const res = await admin("/api/users", {
      method: "POST",
      body: {
        email: "route-test-password-length-create2@example.test",
        password: "ValidLength123",
        sendWelcomeEmail: false,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    createdUserId = res.body.id;
  });

  test("resetting a user's password to a too-long value via PUT is rejected", async () => {
    const res = await admin(`/api/users/${createdUserId}`, {
      method: "PUT",
      body: { password: "a".repeat(129) },
    });
    assert.equal(res.status, 400);
  });
});
