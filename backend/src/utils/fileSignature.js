// Multer's fileFilter only checks the client-supplied Content-Type header
// on an upload, which is trivially spoofable -- a file could claim to be
// image/jpeg while actually containing arbitrary bytes. This verifies the
// file's real content matches what it claims to be, checking the first few
// bytes against each format's well-known magic number.
//
// A handful of hardcoded signatures (rather than a library like
// `file-type`) is deliberate: this app only ever accepts a small fixed set
// of formats, and recent `file-type` releases are ESM-only, which doesn't
// mix cleanly with this CommonJS backend.
const isOle2 = (buf) =>
  // The legacy "Compound File Binary" container format — shared by every
  // pre-2007 Office file (.doc, .xls, .ppt alike). This confirms the bytes
  // are really an OLE2 container and not, say, plain text with a spoofed
  // Content-Type; it can't tell a .doc from an .xls, since nothing at this
  // level distinguishes them without parsing the container's internals.
  buf.length >= 8 &&
  buf[0] === 0xd0 &&
  buf[1] === 0xcf &&
  buf[2] === 0x11 &&
  buf[3] === 0xe0 &&
  buf[4] === 0xa1 &&
  buf[5] === 0xb1 &&
  buf[6] === 0x1a &&
  buf[7] === 0xe1;
const isZip = (buf) =>
  // Modern Office formats (.docx, .xlsx) are ZIP archives under the hood —
  // same caveat as OLE2 above, this confirms "a real ZIP container", not
  // specifically "a Word document".
  buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

// HEIC/HEIF files are ISO Base Media File Format (the same container family
// as MP4): a "ftyp" box at byte offset 4, followed by a 4-byte major brand.
// These are the brand codes real-world encoders (iPhones especially) and
// the HEIF spec itself actually produce -- "heic" covers the overwhelming
// majority of iPhone photos, the rest cover the less common profiles
// (10-bit, multiview, scalable, image sequences).
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);
const isHeic = (buf) =>
  buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp" && HEIC_BRANDS.has(buf.toString("ascii", 8, 12));

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
  // Browsers are inconsistent about which of these two MIME types they
  // report for a HEIC file (sometimes neither, see resolveImageExt in
  // routes/partners.js) -- registering the same check under both means
  // whichever one a given browser sends still verifies correctly.
  "image/heic": isHeic,
  "image/heif": isHeic,
  "application/pdf": (buf) => buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-",
  "application/msword": isOle2,
  "application/vnd.ms-excel": isOle2,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
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
