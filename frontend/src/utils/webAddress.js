// The server's rule (backend/src/utils/webAddress.js), plus one hint-only check (a host with no dot): only http and https web addresses are kept,
// and a bare address with no scheme ("example.org/give") is saved as "https://example.org/give".
export const WEB_ADDRESS_PROBLEM =
  "That doesn't look like a web address. Try example.org or https://example.org";

// Returns the address as it will be saved, or undefined when it is not an http(s) web address.
export function normalizeWebAddress(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]*:\d+(\/|$)/.test(text);
  const candidate = hasScheme ? text : `https://${text.replace(/^\/\//, "")}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.hostname || /\s/.test(candidate) || !/^https?:\/\/[^/]/i.test(candidate)) return undefined;
  // A one-word host ("hello") isn't a web address people mean; a real one has a dot (or is localhost).
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return undefined;
  return candidate;
}

// Plain words for what is wrong, or "" when it can be saved (or the box is empty).
export function webAddressHint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return normalizeWebAddress(text) ? "" : WEB_ADDRESS_PROBLEM;
}

// A mailing address needs somewhere letters can go: a street address with a number, or a PO box. Only a hint (an
// address overseas may have neither), shown under the first line once it has been filled in.
export const STREET_PROBLEM = "Add a street address or a PO box, like 123 Main St or PO Box 45.";
export function streetHint(line1) {
  const text = typeof line1 === "string" ? line1.trim() : "";
  if (!text) return "";
  if (/\d/.test(text)) return "";
  if (/\b(p\.?\s?o\.?\s*box|post office box|box|apartado|postfach|caixa postal)\b/i.test(text)) return "";
  return STREET_PROBLEM;
}
