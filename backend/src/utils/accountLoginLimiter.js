// A limit on failed sign-ins, keyed on the ACCOUNT being tried and on where the attempt comes from. The
// per-address limits in server.js do not stop someone who can change their apparent address (a client that
// writes its own X-Forwarded-For when nothing trusted sits in front, or a spread of addresses); this does,
// because it also keys on the email being tried. Kept in memory: one process runs the app, a restart clears
// it, and it only has to slow a guesser down, not be a permanent record (the audit log is that).
//
// Two counts, so a guesser is stopped without being able to lock the real person out (#594):
//   * per address and account: N failures (10 a window) stops THAT address trying THAT account. A guesser
//     hammering one address is stopped quickly, and the real person, signing in from somewhere else, is not.
//   * per account, any address: a higher ceiling (5 times as many) that catches a guesser who keeps changing
//     address. It stops addresses the account has not signed in from; an address that has signed in with a
//     correct password before (remembered in memory, for 30 days) is let through, so knowing someone's email
//     is not enough to keep them out of the site from their usual place.
// A correct sign-in clears both counts. Someone who knows an email can still make a NEW address wait by
// failing on purpose; it lasts at most the window and only counts failures.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10000;
const KNOWN_ADDRESS_MS = 30 * 24 * 60 * 60 * 1000;
const ANY_ADDRESS_FACTOR = 5;

// Read per call so a test can lower it. 10 failures per window in production; effectively unlimited
// under NODE_ENV=test so the rest of the suite can sign in as the same fixture users freely.
function maxFailures(env = process.env) {
  const n = Number(env.ACCOUNT_LOGIN_MAX_FAILURES);
  if (Number.isInteger(n) && n > 0) return n;
  return env.NODE_ENV === "test" ? 1000 : 10;
}

// Read per call so a test can lower it. Defaults to 5 times the per-address limit.
function maxFailuresAnyAddress(env = process.env) {
  const n = Number(env.ACCOUNT_LOGIN_MAX_FAILURES_ANY_ADDRESS);
  if (Number.isInteger(n) && n > 0) return n;
  return maxFailures(env) * ANY_ADDRESS_FACTOR;
}

const failures = new Map(); // key -> [timestamps of failures in the window]
const knownAddresses = new Map(); // "email@address" -> when a correct sign-in last came from there

function keyFor(scope, email) {
  return `${scope}:${String(email || "")
    .toLowerCase()
    .trim()
    .slice(0, 320)}`;
}

function recent(list, now) {
  return (list || []).filter((t) => now - t < WINDOW_MS);
}

// Seconds until another try is allowed; 0 when it is allowed now.
function retryAfterSeconds(scope, email, now = Date.now(), max = maxFailures()) {
  const list = recent(failures.get(keyFor(scope, email)), now);
  if (list.length < max) return 0;
  // Allowed again once enough of the oldest failures have aged out to drop below the limit.
  const oldestThatMatters = list[list.length - max];
  return Math.max(1, Math.ceil((oldestThatMatters + WINDOW_MS - now) / 1000));
}

function recordFailure(scope, email, now = Date.now()) {
  const key = keyFor(scope, email);
  const list = recent(failures.get(key), now);
  list.push(now);
  failures.delete(key); // re-insert so the oldest keys are the first to go if the map is full
  failures.set(key, list);
  while (failures.size > MAX_KEYS) failures.delete(failures.keys().next().value);
}

function clearFailures(scope, email) {
  failures.delete(keyFor(scope, email));
}

function resetAll() {
  failures.clear();
  knownAddresses.clear();
}

// --- by address and account (what the sign-in routes use) ---

function normEmail(email) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .slice(0, 320);
}
const addressKey = (scope, email, address) =>
  `${scope}@${String(address || "?").slice(0, 80)}:${normEmail(email)}`;
const knownKey = (email, address) => `${normEmail(email)}@${String(address || "?").slice(0, 80)}`;

function isKnownAddress(email, address, now = Date.now()) {
  const at = knownAddresses.get(knownKey(email, address));
  return at !== undefined && now - at < KNOWN_ADDRESS_MS;
}

function waitFor(list, now, max) {
  if (list.length < max) return 0;
  const oldestThatMatters = list[list.length - max];
  return Math.max(1, Math.ceil((oldestThatMatters + WINDOW_MS - now) / 1000));
}

// Seconds this attempt must wait; 0 when it may go ahead.
function checkAttempt(scope, email, address, now = Date.now()) {
  const own = waitFor(recent(failures.get(addressKey(scope, email, address)), now), now, maxFailures());
  if (own > 0) return own;
  if (isKnownAddress(email, address, now)) return 0;
  return waitFor(recent(failures.get(keyFor(scope, email)), now), now, maxFailuresAnyAddress());
}

function recordAttemptFailure(scope, email, address, now = Date.now()) {
  for (const key of [addressKey(scope, email, address), keyFor(scope, email)]) {
    const list = recent(failures.get(key), now);
    list.push(now);
    failures.delete(key);
    failures.set(key, list);
  }
  while (failures.size > MAX_KEYS) failures.delete(failures.keys().next().value);
}

// A correct sign-in: both counts for this account clear, and this address is remembered as one it uses.
function recordAttemptSuccess(scope, email, address, now = Date.now()) {
  failures.delete(addressKey(scope, email, address));
  failures.delete(keyFor(scope, email));
  const key = knownKey(email, address);
  knownAddresses.delete(key);
  knownAddresses.set(key, now);
  while (knownAddresses.size > MAX_KEYS) knownAddresses.delete(knownAddresses.keys().next().value);
}

module.exports = {
  WINDOW_MS,
  maxFailures,
  maxFailuresAnyAddress,
  retryAfterSeconds,
  recordFailure,
  clearFailures,
  checkAttempt,
  recordAttemptFailure,
  recordAttemptSuccess,
  isKnownAddress,
  resetAll,
};
