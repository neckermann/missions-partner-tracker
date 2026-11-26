// Signed, stateless Trips tokens, like emailDispatchShell.js's
// buildSubscriberUnsubscribeToken(): a server-signed JWT, never a DB session or password.
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
// The token opens a minor's record, donor contact details, flights and documents,
// so it must expire: trip end date + 90 days. The 1-year fallback applies only
// when there is no usable trip-dated value (no trip dates loaded at the call
// site, or a historical trip whose end + 90 days has already passed); it is not
// a floor under the trip-dated value. Lost links are re-issuable via the
// lost-link recovery flow, so a short expiry is an inconvenience, not a dead end.
function tripAccessTokenTtlSeconds(participant) {
  const basis = participant.trip?.endDate || participant.trip?.startDate;
  if (!basis) return ONE_YEAR_SECONDS;
  const remaining = Math.floor((new Date(basis).getTime() + NINETY_DAYS_MS - Date.now()) / 1000);
  return remaining > 0 ? remaining : ONE_YEAR_SECONDS;
}

// Encodes the participant's id + accessTokenVersion; bumping that column invalidates every issued link.
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

// Same resolution as dispatchBlurbs.js's base-URL helper. Must also check
// RENDER_EXTERNAL_URL: APP_BASE_URL is optional and rarely set, and Render provides
// the equivalent (see ADMIN_GUIDE.md's APP_BASE_URL entry).
function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

function buildTripParticipantAccessUrl(participant) {
  const base = appBaseUrl();
  return `${base}/my-trip?token=${encodeURIComponent(buildTripParticipantAccessToken(participant))}`;
}

// A short random secret like the other share tokens (participant.shareToken,
// Trip.applicationShareToken); not a JWT since it has no claims, just needs to be
// unguessable and checkable against its @unique column.
function generateShareToken() {
  return crypto.randomBytes(18).toString("base64url");
}

// Lost-link recovery: finds every TripParticipant matching an email
// (case-insensitive) across all trips, with none of the public-discovery/
// restricted-partner exclusions (this is a legitimate participant recovering their
// own access). One combined email per request, however many trips. Resolves the
// same whether or not anything matched, to prevent enumeration (as publicSubscribe.js applySubscription()).
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
