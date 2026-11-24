// Signed, stateless tokens for Trips (#252) -- mirrors
// emailDispatchShell.js's buildSubscriberUnsubscribeToken() pattern: a
// server-signed JWT, never a DB session, never a password.
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");

// #327 Finding 6: no expiresIn at all before this -- the token opened a
// minor's record, donor emails/phone numbers, flights, and documents,
// and stayed valid years after the trip, revoked only by bumping
// accessTokenVersion (an explicit admin action nobody has a reason to
// take once a trip is over). The real lifetime this token needs is
// bounded by the trip itself: trip end date + 90 days, matching the
// review's own recommendation, with a 1-year floor as a safety margin
// for a backfilled historical trip's own dates already being long past
// (re-issuable through the existing lost-link recovery flow either way,
// so an overly-short expiry here is a minor inconvenience, not a dead
// end). Participant.trip isn't loaded at every call site of this
// function, so the fallback (no trip dates available at all) is simply
// a flat 1 year -- still a real, finite bound, just not trip-dated.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
// The 1-year fallback is NOT a floor under the trip-dated value -- a trip
// a few months out should get a tokens whose real lifetime is a few
// months, tighter than a year, which is the whole point. It only
// substitutes when there's no usable trip-dated value at all: trip dates
// missing, or a backfilled historical trip whose end date + 90 days has
// already passed (a negative/zero remaining duration).
function tripAccessTokenTtlSeconds(participant) {
  const basis = participant.trip?.endDate || participant.trip?.startDate;
  if (!basis) return ONE_YEAR_SECONDS;
  const remaining = Math.floor((new Date(basis).getTime() + NINETY_DAYS_MS - Date.now()) / 1000);
  return remaining > 0 ? remaining : ONE_YEAR_SECONDS;
}

// Encodes the participant's id + accessTokenVersion, so bumping that
// column invalidates every previously-issued link at once.
function buildTripParticipantAccessToken(participant) {
  return jwt.sign(
    { id: participant.id, v: participant.accessTokenVersion, tripParticipantAccess: true },
    process.env.SESSION_SECRET,
    { expiresIn: tripAccessTokenTtlSeconds(participant) }
  );
}

function verifyTripParticipantAccessToken(token) {
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    if (!payload.tripParticipantAccess) return null;
    return payload;
  } catch {
    return null;
  }
}

// Same resolution as dispatchBlurbs.js's own base-URL helper -- found via
// a real bug report (a trip-access email's link had no domain at all).
// This file reinvented a narrower version that only checked APP_BASE_URL,
// missing RENDER_EXTERNAL_URL (set automatically by Render for every web
// service, no config needed -- see ADMIN_GUIDE.md's own APP_BASE_URL
// entry). That's exactly why a real production deployment would have hit
// this too, not just local dev: APP_BASE_URL is optional and almost
// never set explicitly, since Render already provides the equivalent.
function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

function buildTripParticipantAccessUrl(participant) {
  const base = appBaseUrl();
  return `${base}/my-trip?token=${encodeURIComponent(buildTripParticipantAccessToken(participant))}`;
}

// A short random secret, same shape/length as every other share-token in
// this app (participant.shareToken, Trip.applicationShareToken) -- not a
// JWT, since this one has no claims to encode, just needs to be
// unguessable and @unique-constraint-checkable directly.
function generateShareToken() {
  return crypto.randomBytes(18).toString("base64url");
}

// §4a lost-link recovery: looks up every TripParticipant row matching an
// email (case-insensitive), across every trip, with none of the public-
// discovery/restricted-partner exclusion rules applied -- this is an
// already-legitimate participant recovering their own access, not a
// stranger trying to discover or apply to a hidden trip. One combined
// email per request, listing every match, regardless of how many trips
// it found -- never one email per trip. Always resolves the same way
// whether anything matched or not, so the caller can't tell them apart
// (same enumeration-prevention precedent as publicSubscribe.js's
// applySubscription()).
async function sendTripParticipantAccessLinks(email) {
  const participants = await prisma.tripParticipant.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    include: { trip: { select: { name: true, type: true, startDate: true } } },
  });
  if (participants.length === 0) return;

  const lines = participants.map((p) => {
    const label = p.trip.name || p.trip.type || "Your trip";
    const dateLabel = p.trip.startDate ? ` (${p.trip.startDate.toDateString()})` : "";
    return `${label}${dateLabel}: ${buildTripParticipantAccessUrl(p)}`;
  });

  await sendEmail({
    to: email,
    subject: "Your trip access link",
    text: `Here's a fresh link to your trip page:\n\n${lines.join("\n\n")}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Here's a fresh link to your trip page:</p><ul>${lines
      .map((l) => `<li>${l}</li>`)
      .join("")}</ul><p>If you didn't request this, you can ignore this email.</p>`,
  });
}

module.exports = {
  buildTripParticipantAccessToken,
  verifyTripParticipantAccessToken,
  buildTripParticipantAccessUrl,
  generateShareToken,
  sendTripParticipantAccessLinks,
  appBaseUrl,
};
