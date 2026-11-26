// A limit on failed sign-ins per ACCOUNT, whatever address they come from. The per-address limits in
// server.js do not stop someone who can change their apparent address (a client that writes its own
// X-Forwarded-For when nothing trusted sits in front, or a spread of addresses): this does, because it
// keys on the email being tried. Kept in memory: one process runs the app, a restart clears it, and it
// only has to slow a guesser down, not be a permanent record (the audit log is that).
//
// Trade-off, accepted: someone who knows an email can make that account's sign-in wait by failing on
// purpose. It lasts at most the window, it only counts failures, and a success clears it.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10000;

// Read per call so a test can lower it. 10 failures per window in production; effectively unlimited
// under NODE_ENV=test so the rest of the suite can sign in as the same fixture users freely.
function maxFailures(env = process.env) {
  const n = Number(env.ACCOUNT_LOGIN_MAX_FAILURES);
  if (Number.isInteger(n) && n > 0) return n;
  return env.NODE_ENV === "test" ? 1000 : 10;
}

const failures = new Map(); // key -> [timestamps of failures in the window]

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
}

module.exports = { WINDOW_MS, maxFailures, retryAfterSeconds, recordFailure, clearFailures, resetAll };
