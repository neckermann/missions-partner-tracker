// Shared by both places a TripParticipant photo gets written -- the
// participant's own self-service edit (publicTrips.js) and an admin
// editing on their behalf (trips.js) -- so the two don't drift into
// different size/type rules over time.
const { matchesFileSignature } = require("./fileSignature");

const PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// `photo` is a base64 data URL ("data:image/png;base64,...."), same
// shape the e-signature canvas already uses for a drawn signature.
//
// #327 Finding 8: this used to check photoContentType against the
// allowlist and stop there -- the actual decoded bytes were never
// verified against it, so a caller could declare image/png while
// sending arbitrary bytes, which publicTripParticipants.js's own
// unauthenticated GET /participants/:id/photo then served back with
// that unverified type.
function decodePhotoDataUrl(photo, photoContentType) {
  const base64 = photo.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error("Photo is too large (5MB max)"), { status: 400 });
  }
  if (!PHOTO_CONTENT_TYPES.has(photoContentType) || !matchesFileSignature(bytes, photoContentType)) {
    throw Object.assign(new Error("Photo must be a JPEG, PNG, or WebP image"), { status: 400 });
  }
  return bytes;
}

module.exports = { decodePhotoDataUrl, PHOTO_CONTENT_TYPES, MAX_PHOTO_BYTES };
