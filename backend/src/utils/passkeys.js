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
  // In production the site's own address must be configured: the relying-party id is the identity a
  // passkey is bound to, so it can't be taken from a request header (#412).
  if (!url && process.env.NODE_ENV === "production") {
    const err = new Error("APP_BASE_URL isn't set, so passkeys can't be used on this site");
    err.status = 500;
    throw err;
  }
  // No configured URL (local dev, tests): trust the request's own host.
  const host = req.get("host") || "localhost";
  const origin = url ? url.origin : `${req.protocol}://${host}`;
  const rpID = url ? url.hostname : host.split(":")[0];
  const origins = [origin];
  if (process.env.NODE_ENV !== "production") origins.push("http://localhost:5173", "http://localhost:3001");
  return { rpID, origins, rpName: process.env.MFA_ISSUER || "Missions Partner Tracker" };
}

// The challenge travels to the browser and back inside a signed token, so nothing about it is
// stored up front. `purpose` keeps a registration challenge from being spent as a sign-in one. A
// token is accepted once: its id is recorded (SpentPasskeyChallenge) until it would have expired
// anyway, in the database so "once" survives a restart and holds across instances (#412).

function signChallenge({ challenge, purpose, userId }) {
  return jwt.sign(
    { challenge, purpose, userId, jti: crypto.randomUUID(), passkeyChallenge: true },
    process.env.SESSION_SECRET,
    { expiresIn: CHALLENGE_TTL_SECONDS }
  );
}

// Returns the challenge, or null when the token is missing, wrong, expired, for another purpose
// or person, or already used.
async function consumeChallenge(token, { purpose, userId }) {
  const prisma = require("../prismaClient"); // lazy: the pure helpers above stay testable without a DB
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (!decoded.passkeyChallenge || decoded.purpose !== purpose || decoded.userId !== userId) return null;
  // Expired ones can never matter again; clearing them here keeps the table tiny.
  await prisma.spentPasskeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.spentPasskeyChallenge.create({
      data: { id: decoded.jti, expiresAt: new Date(decoded.exp * 1000) },
    });
  } catch (err) {
    if (err.code === "P2002") return null; // already used
    throw err;
  }
  return decoded.challenge;
}

const toB64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));

module.exports = { MAX_PASSKEYS, relyingParty, signChallenge, consumeChallenge, toB64u, fromB64u };
