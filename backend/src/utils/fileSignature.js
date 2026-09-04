// Multer's fileFilter only checks the client-supplied Content-Type header
// on an upload, which is trivially spoofable -- a file could claim to be
// image/jpeg while actually containing arbitrary bytes. This verifies the
// file's real content matches what it claims to be, checking the first few
// bytes against each format's well-known magic number.
//
// A handful of hardcoded signatures (rather than a library like
// `file-type`) is deliberate: this app only ever accepts four fixed
// formats, and recent `file-type` releases are ESM-only, which doesn't mix
// cleanly with this CommonJS backend.
const SIGNATURES = {
  "image/jpeg": (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  "image/png": (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,
  "image/webp": (buf) =>
    buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP",
  "application/pdf": (buf) => buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-",
};

// Returns true if `buffer`'s actual content matches what `declaredMime`
// claims it is. A declared type with no known signature (e.g. .eml, which
// has no reliable magic bytes across mail clients) always fails closed --
// callers should only skip this check for formats they've deliberately
// decided can't be verified this way, never by relying on this returning
// true for the unknown case.
function matchesFileSignature(buffer, declaredMime) {
  const check = SIGNATURES[declaredMime];
  return Boolean(check && buffer && check(buffer));
}

module.exports = { matchesFileSignature };
