// A mailing address as a survey carries it: one JSON line of { line1, line2, city, region, postal,
// country }, blanks left out (the server keeps the same canonical form, utils/surveyFields.js).
export const ADDRESS_PARTS = [
  { key: "line1", label: "Street address", autoComplete: "address-line1" },
  { key: "line2", label: "Apartment, suite, box (optional)", autoComplete: "address-line2" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "region", label: "State, province or region", autoComplete: "address-level1" },
  { key: "postal", label: "Postal code", autoComplete: "postal-code" },
  { key: "country", label: "Country", autoComplete: "country-name" },
];

export function parseAddressValue(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The address as the JSON line to store, with blanks dropped ("" when nothing is filled in).
export function addressToValue(parts) {
  const out = {};
  for (const { key } of ADDRESS_PARTS) {
    const v = typeof parts?.[key] === "string" ? parts[key].trim() : "";
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

// One readable line: "12 Main St, Apt 2, Lafayette, LA 70501, USA".
export function formatAddressValue(value) {
  const a = parseAddressValue(value);
  const area = [a.region, a.postal].filter(Boolean).join(" ");
  return [a.line1, a.line2, a.city, area, a.country].filter(Boolean).join(", ");
}
