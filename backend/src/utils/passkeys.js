// #386: the pieces of passkey (WebAuthn) support that aren't routes. The relying-party identity,
// and the short-lived signed "challenge token" that stands in for server-side challenge storage.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const MAX_PASSKEYS = 5;
const CHALLENGE_TTL_SECONDS = 300;

// The relying party is this site. The id is the bare hostname, so a passkey works on the one
// origin the app is served from (and breaks, on purpose, if the site moves to another host).
function relyingParty(req) {
  const base = (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  let url = null;
  try {
    url = base ? new URL(base) : null;
  } catch {
    url = null;
  }
  // No configured URL (local dev, tests): trust the request's own host.
  const host = req.get("host") || "localhost";
  const origin = url ? url.origin : `${req.protocol}://${host}`;
  const rpID = url ? url.hostname : host.split(":")[0];
  const origins = [origin];
  if (process.env.NODE_ENV !== "production") origins.push("http://localhost:5173", "http://localhost:3001");
  return { rpID, origins, rpName: process.env.MFA_ISSUER || "Missions Partner Tracker" };
}

// The challenge travels to the browser and back inside a signed token, so nothing is stored.
// `purpose` keeps a registration challenge from being spent as a sign-in one. A token is accepted
// once: its id is remembered until it would have expired anyway.
const spent = new Map();
function sweep(now) {
  for (const [jti, exp] of spent) if (exp <= now) spent.delete(jti);
}

function signChallenge({ challenge, purpose, userId }) {
  return jwt.sign(
    { challenge, purpose, userId, jti: crypto.randomUUID(), passkeyChallenge: true },
    process.env.SESSION_SECRET,
    { expiresIn: CHALLENGE_TTL_SECONDS }
  );
}

// Returns the challenge, or null when the token is missing, wrong, expired, for another purpose
// or person, or already used.
function consumeChallenge(token, { purpose, userId }) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (!decoded.passkeyChallenge || decoded.purpose !== purpose || decoded.userId !== userId) return null;
  const now = Date.now();
  sweep(now);
  if (spent.has(decoded.jti)) return null;
  spent.set(decoded.jti, decoded.exp * 1000);
  return decoded.challenge;
}

const toB64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));

module.exports = { MAX_PASSKEYS, relyingParty, signChallenge, consumeChallenge, toB64u, fromB64u };
