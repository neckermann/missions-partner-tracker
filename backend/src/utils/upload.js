// Shared shape behind every file-upload route's multer config (see #135):
// resolve a file's real extension from its MIME type, with an optional
// filename-based fallback for formats a browser's own reported MIME type
// can't be trusted for (an .eml's is often blank/application-octet-stream;
// HEIC/HEIF has no reliable Windows MIME registration), then reject the
// upload outright in multer's own fileFilter if neither resolves.
const multer = require("multer");

// mimeToExt: { [mimeType]: extension }. fallback (optional): { test(fileName),
// ext } -- a predicate plus the extension to use when it matches.
function makeExtResolver(mimeToExt, fallback) {
  return function resolveExt(file) {
    if (mimeToExt[file.mimetype]) return mimeToExt[file.mimetype];
    if (fallback && fallback.test(file.originalname)) return fallback.ext;
    return null;
  };
}

// A memoryStorage multer instance that 400s via fileFilter whenever
// resolveExt can't place the upload, with the caller's own rejection
// message (every route accepts a different file-type set, so the message
// is never shared, only the mechanics are).
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

module.exports = { makeExtResolver, uploadFilteredBy };
