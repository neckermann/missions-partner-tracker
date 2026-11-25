// Sends a file stored in the database back to the browser. Shared by the
// newsletter and document download routes.
//
// A file is served `inline` (rendered) only if its bytes were verified against its
// declared type on upload (utils/fileSignature.js); everything else downloads.
// This matters for .eml: it has no reliable magic bytes, so upload skips
// verification and the stored contentType is whatever the client claimed. Otherwise
// an editor could upload `notes.eml` declaring `text/html` and an admin opening it
// would render attacker markup on this origin (CSP blocks scripts, so the ceiling
// is same-origin phishing UI). Forcing the download costs nothing.

// Types verified at upload and so safe to render; mirrors utils/fileSignature.js.
// image/webp is accepted and verified by routes/partners.js for photos only.
const VERIFIED_INLINE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

// A filename reaches a response header. busboy percent-decodes RFC 5987
// `filename*`, so control characters can survive an upload and Node rejects
// them in a header (a 500). Strip anything that can't safely appear.
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
  // Partner records behind a login: no shared cache should keep a copy.
  res.set("Cache-Control", "private, no-store");
  res.send(record.bytes);
}

module.exports = { sendStoredFile, safeFilename, VERIFIED_INLINE_TYPES };
