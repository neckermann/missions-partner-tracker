import { parsePhoneNumberFromString } from "libphonenumber-js/min";

// The country a number without a "+" is read in. The server saves every phone in international
// form, so this only matters for numbers saved before that, or typed into a box before saving.
const DEFAULT_COUNTRY = "US";

// A phone as a person reads it: "(506) 555-0259" for a North American number, "+44 20 7946 0958"
// for anything else, and exactly what was given when it isn't a number we can read (so nothing is
// ever hidden). Blank stays blank.
export function formatPhone(value, country = DEFAULT_COUNTRY) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isPossible()) return text;
  return parsed.countryCallingCode === "1" ? parsed.formatNational() : parsed.formatInternational();
}
