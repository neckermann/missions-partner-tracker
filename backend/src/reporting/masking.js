// Who may see what, applied in ONE place after a report computes -- never
// inside an individual report, so no report can forget it or opt out.
//
// Two audiences:
//  - "admin": a signed-in admin/editor/viewer looking at the app. They
//    already read every partner's full record (see ADMIN_GUIDE.md "Who can
//    see what"), so rows pass through unchanged.
//  - "shared": anything that leaves the signed-in app -- a scheduled email,
//    a public summary. A restricted-access partner is reduced to initials
//    and every column marked `sensitive` is blanked for that partner's rows,
//    the same promise the public site and dispatch channels already make.
//
// A report marks a row about a restricted partner with `_restricted: true`
// and the partner-name column key as `partnerName`. Keys that start with an
// underscore are internal and are always stripped from the output.
const { toInitials } = require("../utils/maskData");

const PARTNER_NAME_KEY = "partnerName";
// #327 Finding 10 -- same generic fallback maskedDisplayName() uses when
// initials are turned off and there's no fieldDisplayName to fall back
// to. A flattened report row only ever carries the one partnerName
// string column, with no separate fieldDisplayName column available the
// way a real Partner record has one, so this path can't offer that
// fallback the way every other masking site in the app does -- it's
// initials-or-this-fixed-label, not initials-or-fieldDisplayName-or-this.
const GENERIC_RESTRICTED_LABEL = "A restricted-access partner";

function stripInternal(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

function maskRow(row, sensitiveKeys, settings) {
  const out = stripInternal(row);
  if (!row._restricted) return out;
  if (PARTNER_NAME_KEY in out) {
    out[PARTNER_NAME_KEY] =
      settings?.restrictedPartnerInitialsEnabled === false
        ? GENERIC_RESTRICTED_LABEL
        : toInitials(String(out[PARTNER_NAME_KEY] || ""));
  }
  for (const key of sensitiveKeys) {
    if (key in out) out[key] = null;
  }
  return out;
}

function applyMasking(rows, columns, audience = "admin", settings) {
  if (audience !== "shared") return rows.map(stripInternal);
  const sensitiveKeys = columns.filter((c) => c.sensitive).map((c) => c.key);
  return rows.map((r) => maskRow(r, sensitiveKeys, settings));
}

module.exports = { applyMasking, PARTNER_NAME_KEY };
