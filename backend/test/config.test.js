const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateEnv, assertValidEnv } = require("../src/config/env");

// validateEnv is pure and takes the env as an argument, so these never touch
// process.env and never risk exiting the test runner.
const GOOD_SECRET = crypto.randomBytes(48).toString("base64");
const GOOD_KEY = crypto.randomBytes(32).toString("base64");

const valid = () => ({
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: GOOD_SECRET,
  FIELD_ENCRYPTION_KEY: GOOD_KEY,
});

const withSecret = (SESSION_SECRET) => ({ ...valid(), SESSION_SECRET });

describe("validateEnv", () => {
  test("a fully-configured environment has nothing to report", () => {
    const { fatal, warnings } = validateEnv(valid());
    assert.deepEqual(fatal, []);
    assert.deepEqual(warnings, []);
  });

  describe("SESSION_SECRET is fatal", () => {
    // Anyone who can read the public repo knows the placeholder, so a fork
    // deployed with it has a forgeable admin session. That's the whole reason
    // this validator exists -- see src/config/env.js.
    const badSecrets = {
      missing: undefined,
      empty: "",
      whitespace: "   ",
      "the .env.example placeholder": "change-me-to-a-long-random-string",
      "a placeholder in different case": "CHANGE-ME-TO-A-LONG-RANDOM-STRING",
      "another obvious stand-in": "changeme",
      "too short": "a".repeat(31),
    };

    for (const [label, value] of Object.entries(badSecrets)) {
      test(label, () => {
        const { fatal } = validateEnv(withSecret(value));
        assert.equal(fatal.length, 1);
        assert.match(fatal[0], /SESSION_SECRET/);
      });
    }

    test("exactly at the minimum length is accepted", () => {
      assert.deepEqual(validateEnv(withSecret("a".repeat(32))).fatal, []);
    });
  });

  test("a missing DATABASE_URL is fatal", () => {
    const { fatal } = validateEnv({ ...valid(), DATABASE_URL: undefined });
    assert.equal(fatal.length, 1);
    assert.match(fatal[0], /DATABASE_URL/);
  });

  test("reports every fatal problem at once, not just the first", () => {
    const { fatal } = validateEnv({});
    assert.equal(fatal.length, 2);
  });

  describe("FIELD_ENCRYPTION_KEY only warns", () => {
    // A bad key makes utils/crypto.js throw at first use, so MFA enrollment
    // fails loudly and nothing is ever written under a weak key. Refusing to
    // boot would take a running deployment offline over a feature that
    // already fails closed.
    const badKeys = {
      missing: undefined,
      empty: "",
      "the .env.example placeholder": "change-me-to-a-real-generated-key",
      // 24 bytes, not 32 -- which is what the shipped placeholder happens to
      // decode to, and why it throws rather than encrypting weakly.
      "decodes to the wrong length": crypto.randomBytes(24).toString("base64"),
    };

    for (const [label, value] of Object.entries(badKeys)) {
      test(label, () => {
        const { fatal, warnings } = validateEnv({ ...valid(), FIELD_ENCRYPTION_KEY: value });
        assert.deepEqual(fatal, [], "must never block startup");
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /FIELD_ENCRYPTION_KEY/);
        assert.match(warnings[0], /two-factor/i, "says what actually breaks");
      });
    }
  });
});

describe("assertValidEnv", () => {
  // A fake logger, so the assertions can check what an operator would see
  // without the test output filling up with config warnings.
  const fakeLog = () => {
    const lines = { warn: [], error: [] };
    return {
      log: { warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) },
      lines,
    };
  };

  test("passes a valid environment through without exiting", () => {
    const { log, lines } = fakeLog();
    assertValidEnv(valid(), { log });
    assert.deepEqual(lines.warn, []);
    assert.deepEqual(lines.error, []);
  });

  test("prints warnings but still returns", () => {
    const { log, lines } = fakeLog();
    assertValidEnv({ ...valid(), FIELD_ENCRYPTION_KEY: "" }, { log });
    assert.equal(lines.warn.length, 1);
    assert.match(lines.warn[0], /\[config\]/);
  });

  test("exits with a non-zero code when something is fatal", () => {
    const { log, lines } = fakeLog();
    const realExit = process.exit;
    let exitCode;
    // Throw out of the fake exit so execution stops where the real one would,
    // instead of running on with an invalid config.
    process.exit = (code) => {
      exitCode = code;
      throw new Error("exited");
    };
    try {
      assert.throws(() => assertValidEnv(withSecret(""), { log }), /exited/);
    } finally {
      process.exit = realExit;
    }
    assert.equal(exitCode, 1);
    assert.ok(
      lines.error.some((l) => /SESSION_SECRET/.test(l)),
      "the operator is told which setting is wrong"
    );
  });
});
