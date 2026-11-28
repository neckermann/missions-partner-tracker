// The per-account limit on failed sign-ins (B9 of the November 2026 app review): it keys on the account,
// so changing the address a request seems to come from does not reset it.
const { test, describe, beforeEach, afterEach } = require("node:test");
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

describe("accountLoginLimiter, by address and account (#594)", () => {
  const T1 = 2_000_000_000_000;
  const KEYS = ["ACCOUNT_LOGIN_MAX_FAILURES", "ACCOUNT_LOGIN_MAX_FAILURES_ANY_ADDRESS"];
  let saved;
  beforeEach(() => {
    limiter.resetAll();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("failures from one address stop that address only", () => {
    process.env.ACCOUNT_LOGIN_MAX_FAILURES = "3";
    process.env.ACCOUNT_LOGIN_MAX_FAILURES_ANY_ADDRESS = "50";
    try {
      for (let i = 0; i < 3; i++) limiter.recordAttemptFailure("login", "a@x.test", "1.1.1.1", T1);
      assert.ok(limiter.checkAttempt("login", "a@x.test", "1.1.1.1", T1 + 1) > 0);
      assert.equal(limiter.checkAttempt("login", "a@x.test", "2.2.2.2", T1 + 1), 0);
    } finally {
      // restored in afterEach
    }
  });

  test("the account-wide ceiling holds back new addresses but not one that has signed in", () => {
    process.env.ACCOUNT_LOGIN_MAX_FAILURES = "3";
    process.env.ACCOUNT_LOGIN_MAX_FAILURES_ANY_ADDRESS = "5";
    try {
      limiter.recordAttemptSuccess("login", "a@x.test", "9.9.9.9", T1);
      for (let i = 0; i < 5; i++) limiter.recordAttemptFailure("login", "a@x.test", `7.7.7.${i}`, T1 + i);
      assert.ok(limiter.checkAttempt("login", "a@x.test", "8.8.8.8", T1 + 10) > 0, "a new address waits");
      assert.equal(
        limiter.checkAttempt("login", "a@x.test", "9.9.9.9", T1 + 10),
        0,
        "the known address goes through"
      );
    } finally {
      // restored in afterEach
    }
  });

  test("a correct sign-in clears the counts, and an address is only 'known' for a while", () => {
    process.env.ACCOUNT_LOGIN_MAX_FAILURES = "3";
    process.env.ACCOUNT_LOGIN_MAX_FAILURES_ANY_ADDRESS = "3";
    try {
      for (let i = 0; i < 2; i++) limiter.recordAttemptFailure("login", "a@x.test", "1.1.1.1", T1);
      limiter.recordAttemptSuccess("login", "a@x.test", "1.1.1.1", T1);
      assert.equal(limiter.checkAttempt("login", "a@x.test", "1.1.1.1", T1 + 1), 0);
      assert.equal(limiter.isKnownAddress("a@x.test", "1.1.1.1", T1 + 1000), true);
      assert.equal(limiter.isKnownAddress("a@x.test", "1.1.1.1", T1 + 31 * 24 * 60 * 60 * 1000), false);
    } finally {
      // restored in afterEach
    }
  });
});
