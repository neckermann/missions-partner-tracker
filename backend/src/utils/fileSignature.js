// Multer's fileFilter checks only the client-supplied Content-Type, which is
// trivially spoofable. This verifies the real content against each format's
// magic number. Hardcoded signatures rather than `file-type`: only a small fixed
// set of formats is accepted, and recent `file-type` is ESM-only (this backend is CommonJS).
const isOle2 = (buf) =>
  // The "Compound File Binary" container shared by every pre-2007 Office file
  // (.doc, .xls, .ppt). Confirms an OLE2 container, not which Office type.
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
  // .docx/.xlsx are ZIP archives; this confirms a ZIP container, not a Word document.
  buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

// HEIC/HEIF is ISO Base Media File Format: a "ftyp" box at byte 4 followed by a
// 4-byte major brand. These are the brands real encoders (iPhones) and the HEIF
// spec produce; "heic" covers most iPhone photos.
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
  // Browsers are inconsistent about which of these MIME types they report for
  // HEIC (sometimes neither; see resolveImageExt in routes/partners.js), so register both.
  "image/heic": isHeic,
  "image/heif": isHeic,
  "application/pdf": (buf) => buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-",
  "application/msword": isOle2,
  "application/vnd.ms-excel": isOle2,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
};

// True if `buffer`'s content matches what `declaredMime` claims. A declared type
// with no known signature (e.g. .eml) always fails closed: callers may skip this
// only for formats they deliberately decided can't be verified, never by relying
// on true for the unknown case.
function matchesFileSignature(buffer, declaredMime) {
  const check = SIGNATURES[declaredMime];
  return Boolean(check && buffer && check(buffer));
}

// .eml's Content-Type is unreliable (often octet-stream or blank) and it has no
// magic bytes, so it's recognized by extension, as in utils/extraction.js isEml
// (duplicated: that is a higher-level module).
function isEmlFilename(fileName) {
  return /\.eml$/i.test(fileName || "");
}

// The one place an uploaded file's real type is decided; every upload route
// should call this rather than trust file.mimetype. Returns { ok: true,
// contentType } with the type to store, or { ok: false } when the bytes don't
// match. A .eml is never signature-checked and is stored as message/rfc822.
// `signatureMimeOverride` lets a caller first resolve a browser-unreliable type
// (HEIC/webp, see resolveImageExt in routes/partners.js).
function verifyUpload(file, { signatureMimeOverride } = {}) {
  if (isEmlFilename(file.originalname)) {
    return { ok: true, contentType: "message/rfc822" };
  }
  const contentType = signatureMimeOverride || file.mimetype;
  if (!matchesFileSignature(file.buffer, contentType)) {
    return { ok: false };
  }
  return { ok: true, contentType };
}

module.exports = { matchesFileSignature, isEmlFilename, verifyUpload };
