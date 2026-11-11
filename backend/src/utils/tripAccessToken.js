// Signed, stateless tokens for Trips (#252) -- mirrors
// emailDispatchShell.js's buildSubscriberUnsubscribeToken() pattern: a
// server-signed JWT, never a DB session, never a password.
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");

// Encodes the participant's id + accessTokenVersion, so bumping that
// column invalidates every previously-issued link at once.
function buildTripParticipantAccessToken(participant) {
  return jwt.sign(
    { id: participant.id, v: participant.accessTokenVersion, tripParticipantAccess: true },
    process.env.SESSION_SECRET
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

function appBaseUrl() {
  return process.env.APP_BASE_URL || "";
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
};
