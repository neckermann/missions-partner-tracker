// Sends a file stored in the database back to the browser.
//
// Shared by the newsletter and document download routes, which were
// byte-identical, so the rule below lives in one place rather than two.
//
// The rule: a file is only served `inline` -- i.e. rendered by the browser
// -- if its bytes were actually verified against its declared type on the
// way in (see utils/fileSignature.js). Everything else downloads.
//
// That matters for .eml specifically. Email files have no reliable magic
// bytes across mail clients, so upload skips signature verification for
// them, and the stored contentType is whatever the client claimed. Without
// this, an editor could upload `notes.eml` declaring `text/html`, and an
// admin opening it would render attacker-authored markup on this app's own
// origin. Helmet's CSP blocks scripts, so the ceiling is convincing
// same-origin phishing UI rather than XSS -- but nobody reads a raw .eml in
// a browser tab anyway, so forcing the download costs nothing and removes
// the vector.

// Types whose bytes are checked at upload time and are therefore safe to
// hand the browser to render. Mirrors utils/fileSignature.js.
const VERIFIED_INLINE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

// A filename reaches a response header here. busboy percent-decodes RFC 5987
// `filename*`, so control characters can survive an upload; Node rejects
// those when setting a header, turning a bad filename into a 500 rather than
// a clean response. Strip anything that can't safely appear.
function safeFilename(name) {
  const cleaned = [...String(name || "")]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x20 || code === 0x7f) return false; // control chars, incl. CR/LF
      return ch !== '"' && ch !== "\\"; // would break out of the quoted header value
    })
    .join("")
    .trim()
    .slice(0, 200);

  return cleaned || "file";
}

function sendStoredFile(res, record) {
  const declared = record.contentType || "application/octet-stream";
  const inlineSafe = VERIFIED_INLINE_TYPES.has(declared);
  const filename = safeFilename(record.fileName);

  res.set("Content-Type", inlineSafe ? declared : "application/octet-stream");
  res.set("Content-Disposition", `${inlineSafe ? "inline" : "attachment"}; filename="${filename}"`);
  // These are partner records behind a login; no shared cache should keep a
  // copy, and the download URL shouldn't be re-served to anyone else.
  res.set("Cache-Control", "private, no-store");
  res.send(record.bytes);
}

module.exports = { sendStoredFile, safeFilename, VERIFIED_INLINE_TYPES };
