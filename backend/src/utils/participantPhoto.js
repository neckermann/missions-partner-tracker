// Shared by both places a TripParticipant photo is written (the participant's
// self-service edit in publicTrips.js and an admin edit in trips.js) so the size/type rules can't drift.
const { matchesFileSignature } = require("./fileSignature");

const PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// `photo` is a base64 data URL ("data:image/png;base64,...."), like the e-signature
// canvas. The decoded bytes are verified against the declared type: the
// unauthenticated GET /participants/:id/photo serves it back with that type.
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
