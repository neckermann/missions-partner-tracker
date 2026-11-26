// Startup configuration validation.
//
// This app is forked and self-hosted via `cp .env.example .env`, so a
// plausible-looking placeholder is dangerous: a fork that edits only DATABASE_URL
// would run with a SESSION_SECRET printed in a public repo, letting anyone forge
// an admin session cookie (any valid session reads every partner's full record;
// see ADMIN_GUIDE.md § Who can see what).
//
// So a bad SESSION_SECRET is fatal. Anything that only breaks a feature warns
// loudly and keeps serving: taking a running deployment down over a misconfigured
// optional feature is worse.

// Values shipped in .env.example and other obvious stand-ins.
const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-string",
  "change-me-to-a-real-generated-key",
  "your-secret-here",
  "changeme",
  "change-me",
  "secret",
  "password",
]);

// Long enough that brute-forcing the HMAC key isn't the weakest link (`openssl rand -base64 48`, 64 chars).
const MIN_SECRET_LENGTH = 32;

function isPlaceholder(value) {
  return PLACEHOLDER_SECRETS.has(String(value).trim().toLowerCase());
}

// Pure (no process.exit or console) so it can be unit-tested directly.
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

  // Not fatal: a bad key makes crypto.js throw at first use, so every reversibly
  // encrypted secret (MFA enrollment and the Postmark, GroupMe, Joshua Project and
  // WhatsApp credentials) fails loudly and nothing is written under a weak key.
  // Refusing to boot would take a deployment offline to protect a feature that already fails closed.
  const key = env.FIELD_ENCRYPTION_KEY;
  if (!key || !String(key).trim()) {
    warnings.push(
      "FIELD_ENCRYPTION_KEY is not set. Two-factor authentication and every " +
        "integration that stores a credential (Postmark, GroupMe, Joshua " +
        "Project, WhatsApp) will fail until it is. Generate one with " +
        "`npm run generate-secrets`."
    );
  } else if (isPlaceholder(key) || Buffer.from(String(key), "base64").length !== 32) {
    warnings.push(
      "FIELD_ENCRYPTION_KEY does not decode to exactly 32 bytes, so it is not a " +
        "usable key. Two-factor authentication and every integration that " +
        "stores a credential (Postmark, GroupMe, Joshua Project, WhatsApp) " +
        "will fail until it is fixed. Generate one with `npm run generate-secrets`."
    );
  }

  // Not fatal, as above. Most platforms set this automatically but a self-hoster
  // may not. utils/jwt.js setSessionCookie marks the cookie `secure` only when this
  // is exactly "production"; otherwise it travels over plain HTTP.
  if (env.NODE_ENV !== "production") {
    warnings.push(
      `NODE_ENV is "${env.NODE_ENV || "unset"}", not "production". If this is a real deployment ` +
        "(not local development), set NODE_ENV=production -- otherwise the session cookie is not " +
        "marked secure/HTTPS-only, and can be sent over plain HTTP."
    );
  }

  return { fatal, warnings };
}

// Prints findings and exits(1) if anything is fatal; separate from validateEnv so tests can't kill the runner.
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
