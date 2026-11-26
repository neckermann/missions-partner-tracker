// The per-account limit on failed sign-ins (B9 of the November 2026 app review): it keys on the account,
// so changing the address a request seems to come from does not reset it.
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const limiter = require("../src/utils/accountLoginLimiter");

const T0 = 1_000_000_000_000;
beforeEach(() => limiter.resetAll());

describe("accountLoginLimiter", () => {
  test("allows attempts until the limit, then says how long to wait", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(limiter.retryAfterSeconds("login", "a@x.test", T0 + i * 1000, 3), 0);
      limiter.recordFailure("login", "a@x.test", T0 + i * 1000);
    }
    const wait = limiter.retryAfterSeconds("login", "a@x.test", T0 + 3000, 3);
    assert.ok(wait > 0 && wait <= 15 * 60, `wait ${wait}`);
  });

  test("the wait ends when the oldest failure leaves the 15-minute window", () => {
    for (let i = 0; i < 3; i++) limiter.recordFailure("login", "a@x.test", T0 + i * 1000);
    assert.ok(limiter.retryAfterSeconds("login", "a@x.test", T0 + 60_000, 3) > 0);
    assert.equal(limiter.retryAfterSeconds("login", "a@x.test", T0 + limiter.WINDOW_MS + 1, 3), 0);
  });

  test("an email is the same account whatever its case or spacing", () => {
    for (let i = 0; i < 3; i++) limiter.recordFailure("login", "  A@X.test ", T0);
    assert.ok(limiter.retryAfterSeconds("login", "a@x.test", T0 + 1, 3) > 0);
  });

  test("one account's failures do not slow another's, and passwords and codes count separately", () => {
    for (let i = 0; i < 3; i++) limiter.recordFailure("login", "a@x.test", T0);
    assert.equal(limiter.retryAfterSeconds("login", "b@x.test", T0 + 1, 3), 0);
    assert.equal(limiter.retryAfterSeconds("mfa", "a@x.test", T0 + 1, 3), 0);
  });

  test("a success clears the count", () => {
    for (let i = 0; i < 3; i++) limiter.recordFailure("login", "a@x.test", T0);
    limiter.clearFailures("login", "a@x.test");
    assert.equal(limiter.retryAfterSeconds("login", "a@x.test", T0 + 1, 3), 0);
  });

  test("the limit is 10 in production, effectively none under test, and can be set", () => {
    assert.equal(limiter.maxFailures({}), 10);
    assert.equal(limiter.maxFailures({ NODE_ENV: "production" }), 10);
    assert.equal(limiter.maxFailures({ NODE_ENV: "test" }), 1000);
    assert.equal(limiter.maxFailures({ ACCOUNT_LOGIN_MAX_FAILURES: "3", NODE_ENV: "test" }), 3);
    assert.equal(limiter.maxFailures({ ACCOUNT_LOGIN_MAX_FAILURES: "nope" }), 10);
  });
});
