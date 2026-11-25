// POST /api/auth/password-setup/validate takes the token in the body, not the query string: a
// usable setup-link credential in a URL is written to access logs, can leak via a Referer
// header, and sits in browser history.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { issueSetupToken } = require("../../src/utils/passwordSetup");
const { client, stopServer } = require("./helpers");

let anon;
let user;

before(async () => {
  anon = await client(null);
  // passwordHash: null -- a real account that was created but hasn't set
  // up its own password yet, the normal case this flow exists for.
  user = await prisma.user.create({
    data: {
      email: "route-test-password-setup-validate@example.test",
      passwordHash: null,
      role: "editor",
      active: true,
      authProvider: "local",
      firstName: "Pat",
      mfaSetupRequired: true,
    },
  });
});

after(async () => {
  await prisma.passwordSetupToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await stopServer();
});

describe("POST /api/auth/password-setup/validate", () => {
  test("a valid token returns the account's email/firstName/mfaRequired", async () => {
    const { token } = await issueSetupToken(user);
    const res = await anon("/api/auth/password-setup/validate", { method: "POST", body: { token } });
    assert.equal(res.status, 200);
    assert.equal(res.body.email, user.email);
    assert.equal(res.body.firstName, "Pat");
    assert.equal(res.body.mfaRequired, true);
  });

  test("an invalid token is rejected with the generic message", async () => {
    const res = await anon("/api/auth/password-setup/validate", {
      method: "POST",
      body: { token: "not-a-real-token" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid or has expired/i);
  });

  test("the old GET route no longer exists", async () => {
    const { token } = await issueSetupToken(user);
    const res = await anon(`/api/auth/password-setup/validate?token=${encodeURIComponent(token)}`);
    assert.notEqual(res.status, 200, "GET must not validate a token any more");
  });
});
