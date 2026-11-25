// Whether a partner file can go through AI Request Scanning. Matches backend/src/utils/extraction.js
// SUPPORTED_CONTENT_TYPES/isEml exactly (PDF/JPEG/PNG by contentType, or .eml by extension since
// browsers report .eml's contentType unreliably), so the Scan button isn't shown for a file that 400s.
export const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function isScannable(record) {
  return SCANNABLE_TYPES.has(record.contentType) || /\.eml$/i.test(record.fileName || "");
}
