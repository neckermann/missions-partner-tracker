// Whether a partner file can go through AI Request Scanning -- matches
// backend/src/utils/extraction.js's SUPPORTED_CONTENT_TYPES/isEml exactly
// (PDF/JPEG/PNG by contentType, or .eml by filename extension, since a
// browser's own reported contentType for .eml is unreliable). Used to
// decide whether to show the Scan button at all rather than one that
// 400s on an unsupported file (Word/Excel aren't supported).
//
// Copy-pasted identically across AdminPartnerFiles.jsx and
// PartnerFileSection.jsx (see #135); same hoisting reasoning as
// utils/format.js.
export const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function isScannable(record) {
  return SCANNABLE_TYPES.has(record.contentType) || /\.eml$/i.test(record.fileName || "");
}
