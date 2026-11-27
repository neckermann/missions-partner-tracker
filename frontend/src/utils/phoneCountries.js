import { getCountries, getCountryCallingCode } from "libphonenumber-js/min";

// Every country a phone number can belong to, labelled "United States (+1)" and sorted by name, for the
// church setting that decides which country a number typed without a "+" is read in.
export const PHONE_COUNTRIES = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return getCountries()
    .map((code) => ({ code, label: `${names.of(code) || code} (+${getCountryCallingCode(code)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
})();

// The label for a code, or the code itself when it isn't known.
export function phoneCountryLabel(code) {
  return PHONE_COUNTRIES.find((c) => c.code === code)?.label || code || "";
}
