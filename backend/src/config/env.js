// Startup configuration validation.
//
// This app is meant to be forked and self-hosted, and the documented setup
// path is `cp .env.example .env`. That makes a plausible-looking placeholder
// genuinely dangerous: a fork that edits only DATABASE_URL and deploys would
// run with a SESSION_SECRET printed in a public repo, and anyone who has read
// that repo could forge an admin session cookie. There is no second line of
// defence behind it -- any valid session can read every partner's full record
// (see ADMIN_GUIDE.md § Who can see what).
//
// So a bad SESSION_SECRET is fatal: the process refuses to start rather than
// serving with a known key. Everything else that can only break a feature
// (rather than expose data) warns loudly and keeps serving, because taking a
// running deployment down over a misconfigured optional feature is worse than
// the feature being broken.

// Values shipped in .env.example and other obvious stand-ins. Anyone who
// reaches this list has copied an example file without reading it.
const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-string",
  "change-me-to-a-real-generated-key",
  "your-secret-here",
  "changeme",
  "change-me",
  "secret",
  "password",
]);

// Long enough that brute-forcing the HMAC key is not the weakest link. 48
// bytes of base64 (`openssl rand -base64 48`) is 64 chars, comfortably over.
const MIN_SECRET_LENGTH = 32;

function isPlaceholder(value) {
  return PLACEHOLDER_SECRETS.has(String(value).trim().toLowerCase());
}

// Pure: takes an env-shaped object, returns what's wrong with it. Kept free of
// process.exit and console so it can be unit-tested directly.
function validateEnv(env = process.env) {
  const fatal = [];
  const warnings = [];

  if (!env.DATABASE_URL || !String(env.DATABASE_URL).trim()) {
    fatal.push("DATABASE_URL is not set. Point it at your Postgres database.");
  }

  const secret = env.SESSION_SECRET;
  if (!secret || !String(secret).trim()) {
    fatal.push(
      "SESSION_SECRET is not set. Generate one with `npm run generate-secrets` " +
        "(or `openssl rand -base64 48`) and put it in your .env."
    );
  } else if (isPlaceholder(secret)) {
    fatal.push(
      "SESSION_SECRET is still the example placeholder. This value is published " +
        "in the public repo, so anyone could forge an admin session. Generate a " +
        "real one with `npm run generate-secrets`."
    );
  } else if (String(secret).length < MIN_SECRET_LENGTH) {
    fatal.push(
      `SESSION_SECRET is only ${String(secret).length} characters; it must be at ` +
        `least ${MIN_SECRET_LENGTH}. Generate one with \`npm run generate-secrets\`.`
    );
  }

  // Not fatal: a bad key makes crypto.js throw at first use, so MFA enrollment
  // fails loudly and nothing is ever written under a weak key. Refusing to boot
  // over it would take a running deployment offline to protect a feature that
  // already fails closed.
  const key = env.FIELD_ENCRYPTION_KEY;
  if (!key || !String(key).trim()) {
    warnings.push(
      "FIELD_ENCRYPTION_KEY is not set. Enrolling in two-factor authentication " +
        "will fail until it is. Generate one with `npm run generate-secrets`."
    );
  } else if (isPlaceholder(key) || Buffer.from(String(key), "base64").length !== 32) {
    warnings.push(
      "FIELD_ENCRYPTION_KEY does not decode to exactly 32 bytes, so it is not a " +
        "usable key. Enrolling in two-factor authentication will fail until it " +
        "is fixed. Generate one with `npm run generate-secrets`."
    );
  }

  return { fatal, warnings };
}

// Prints the findings and exits(1) if anything is fatal. Separated from
// validateEnv so tests never risk killing the test runner.
function assertValidEnv(env = process.env, { log = console } = {}) {
  const { fatal, warnings } = validateEnv(env);

  for (const warning of warnings) {
    log.warn(`[config] ${warning}`);
  }

  if (fatal.length) {
    log.error("\n[config] Refusing to start — the configuration is not safe:\n");
    for (const problem of fatal) {
      log.error(`  • ${problem}`);
    }
    log.error("\nSee backend/.env.example for the full list of settings.\n");
    process.exit(1);
  }

  return { fatal, warnings };
}

module.exports = { validateEnv, assertValidEnv, PLACEHOLDER_SECRETS, MIN_SECRET_LENGTH };
