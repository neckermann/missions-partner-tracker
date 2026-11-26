// B9 at the HTTP boundary: failed sign-ins for one account are limited whatever address they appear to
// come from. Each request below claims a different address through X-Forwarded-For, which is exactly what
// a client can do when no trusted proxy sits in front, and which defeats the per-address limits.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  TEST_USERS,
  TEST_PASSWORD,
} = require("./helpers");
const limiter = require("../../src/utils/accountLoginLimiter");

let anon;
const email = TEST_USERS.editor.email;
let saved;

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

beforeEach(() => {
  saved = process.env.ACCOUNT_LOGIN_MAX_FAILURES;
  process.env.ACCOUNT_LOGIN_MAX_FAILURES = "3";
  limiter.resetAll();
});

function restore() {
  if (saved === undefined) delete process.env.ACCOUNT_LOGIN_MAX_FAILURES;
  else process.env.ACCOUNT_LOGIN_MAX_FAILURES = saved;
  limiter.resetAll();
}

let n = 0;
const attempt = (body) =>
  anon("/api/auth/login", {
    method: "POST",
    headers: { "X-Forwarded-For": `203.0.113.${++n}` }, // a new "visitor" every time
    body,
  });

describe("sign-in limit per account", () => {
  test("wrong passwords from ever-changing addresses are stopped, even for the right password", async () => {
    try {
      for (let i = 0; i < 3; i++) assert.equal((await attempt({ email, password: "wrong" })).status, 401);
      const blocked = await attempt({ email, password: "wrong" });
      assert.equal(blocked.status, 429);
      assert.match(blocked.body.error, /Too many failed sign-ins/);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);

      // A guesser who hit the right password still learns nothing while it lasts.
      assert.equal((await attempt({ email, password: TEST_PASSWORD })).status, 429);
    } finally {
      restore();
    }
  });

  test("it is the account that waits, not everyone", async () => {
    try {
      for (let i = 0; i < 3; i++) await attempt({ email, password: "wrong" });
      assert.equal((await attempt({ email, password: "wrong" })).status, 429);
      const other = await attempt({ email: TEST_USERS.viewer.email, password: TEST_PASSWORD });
      assert.equal(other.status, 200);
    } finally {
      restore();
    }
  });

  test("a correct sign-in before the limit clears the count", async () => {
    try {
      for (let i = 0; i < 2; i++) await attempt({ email, password: "wrong" });
      assert.equal((await attempt({ email, password: TEST_PASSWORD })).status, 200);
      for (let i = 0; i < 2; i++) assert.equal((await attempt({ email, password: "wrong" })).status, 401);
    } finally {
      restore();
    }
  });

  test("an email that has no account is counted too, so the answer does not reveal it", async () => {
    try {
      const ghost = "nobody-here@example.test";
      for (let i = 0; i < 3; i++) assert.equal((await attempt({ email: ghost, password: "x" })).status, 401);
      assert.equal((await attempt({ email: ghost, password: "x" })).status, 429);
    } finally {
      restore();
    }
  });
});
