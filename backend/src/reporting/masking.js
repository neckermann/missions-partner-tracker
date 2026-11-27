// Who may see what, applied in ONE place after a report computes, never inside a
// report, so none can forget or opt out.
//  - "admin": a signed-in admin/editor/viewer, who already reads every partner's
//    full record (ADMIN_GUIDE.md "Who can see what"); rows pass unchanged.
//  - "shared": anything leaving the signed-in app (scheduled email, public
//    summary). A restricted partner is reduced to initials and every `sensitive`
//    column is blanked for its rows, as on the public site and dispatch channels.
//
// A report marks a restricted partner's row `_restricted: true` and the name
// column key `partnerName`. Underscore-prefixed keys are internal and always stripped.
const { toInitials } = require("../utils/maskData");

const PARTNER_NAME_KEY = "partnerName";
// Same generic fallback as maskedDisplayName() when initials are off. A flattened
// report row has only a partnerName string (no fieldDisplayName), so this path is
// initials-or-this-fixed-label.
const GENERIC_RESTRICTED_LABEL = "A restricted-access partner";

function stripInternal(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

// `initialsByName` maps a restricted partner's display name to the initials it is shown as (built from its adults by
// restrictedPartnerInitials() in registry.js); a name not in it falls back to initials of the name itself.
function maskRow(row, sensitiveKeys, settings, initialsByName) {
  const out = stripInternal(row);
  if (!row._restricted) return out;
  if (PARTNER_NAME_KEY in out) {
    out[PARTNER_NAME_KEY] =
      settings?.restrictedPartnerInitialsEnabled === false
        ? GENERIC_RESTRICTED_LABEL
        : initialsByName?.get(String(out[PARTNER_NAME_KEY] || "")) ||
          toInitials(String(out[PARTNER_NAME_KEY] || ""));
  }
  for (const key of sensitiveKeys) {
    if (key in out) out[key] = null;
  }
  return out;
}

function applyMasking(rows, columns, audience = "admin", settings, initialsByName) {
  if (audience !== "shared") return rows.map(stripInternal);
  const sensitiveKeys = columns.filter((c) => c.sensitive).map((c) => c.key);
  return rows.map((r) => maskRow(r, sensitiveKeys, settings, initialsByName));
}

module.exports = { applyMasking, PARTNER_NAME_KEY };
