// Link fields hold web addresses, and only web addresses. Until now they took any text, so a
// "javascript:" or "data:" link could be saved and only the content security policy stood between it and a
// click. This keeps the rule on the server, where it can't be bypassed from a browser.
//
// A bare address with no scheme ("example.org/give") is accepted and stored as "https://example.org/give",
// because that is what people type; anything that names another scheme is refused.
const { z } = require("zod");

const MESSAGE = "Enter a web address starting with http:// or https://";

// Returns the address to store, or undefined when it is not an http(s) web address.
function normalizeWebAddress(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  // "host:8080/path" is a bare address with a port, not a scheme; "javascript:..." is a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]*:\d+(\/|$)/.test(text);
  const candidate = hasScheme ? text : `https://${text.replace(/^\/\//, "")}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  // "https:///x" is read by browsers as "https://x"; don't store something that ambiguous.
  if (!url.hostname || /\s/.test(candidate) || !/^https?:\/\/[^/]/i.test(candidate)) return undefined;
  return candidate;
}

const refine = (value, ctx) => {
  const normalized = normalizeWebAddress(value);
  if (normalized === undefined) {
    ctx.addIssue({ code: "custom", message: MESSAGE });
    return z.NEVER;
  }
  return normalized;
};

// A required web address.
const webAddress = () => z.string().transform(refine);

// An optional one: blank, null or missing means "no link" (stored as null); anything else must be valid.
const optionalWebAddress = () =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      if (value === null || String(value).trim() === "") return null;
      return refine(value, ctx);
    });

module.exports = { MESSAGE, normalizeWebAddress, webAddress, optionalWebAddress };
