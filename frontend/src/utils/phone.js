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
  // A North American number is always written (AAA) EEE-NNNN. The library only formats area codes it
  // knows, and would return bare digits for a fictional one like (111) 111-1111, so this is done here.
  if (parsed.countryCallingCode === "1" && parsed.nationalNumber.length === 10) {
    const n = parsed.nationalNumber;
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return parsed.formatInternational();
}
