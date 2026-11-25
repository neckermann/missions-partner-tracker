// Shared shape behind every upload route's multer config: resolve a file's real
// extension from its MIME type, with an optional filename-based fallback for
// formats whose browser-reported MIME can't be trusted (.eml, HEIC/HEIF), then
// reject in multer's fileFilter if neither resolves.
const multer = require("multer");

// mimeToExt: { [mimeType]: extension }. fallback (optional): one { test(fileName),
// ext } pair or an array tried in order (e.g. partners.js needs HEIC and webp).
function makeExtResolver(mimeToExt, fallback) {
  const fallbacks = !fallback ? [] : Array.isArray(fallback) ? fallback : [fallback];
  return function resolveExt(file) {
    if (mimeToExt[file.mimetype]) return mimeToExt[file.mimetype];
    const matched = fallbacks.find((f) => f.test(file.originalname));
    return matched ? matched.ext : null;
  };
}

// A memoryStorage multer instance that 400s via fileFilter when resolveExt can't
// place the upload, with the caller's own message (each route accepts different types).
function uploadFilteredBy(resolveExt, { maxFileSize, message }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize },
    fileFilter: (req, file, cb) => {
      if (!resolveExt(file)) {
        const err = new Error(message);
        err.status = 400;
        return cb(err);
      }
      cb(null, true);
    },
  });
}

// Shared by the admin TripDocument upload and the public self-service upload: one
// allowlist and one size cap. The public route is reachable by anyone with a
// participant's access-token link, so it needs the filter.
const TRIP_DOCUMENT_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const TRIP_DOCUMENT_MAX_FILE_SIZE = 15 * 1024 * 1024; // matches the admin route's pre-existing cap
function tripDocumentUpload() {
  return uploadFilteredBy(makeExtResolver(TRIP_DOCUMENT_MIME_TO_EXT), {
    maxFileSize: TRIP_DOCUMENT_MAX_FILE_SIZE,
    message: "That file type isn't supported here -- upload a JPG, PNG, WEBP, or PDF.",
  });
}

module.exports = { makeExtResolver, uploadFilteredBy, tripDocumentUpload, TRIP_DOCUMENT_MAX_FILE_SIZE };
