import { getCountries } from "libphonenumber-js/min";

// Country name -> ISO 3166-1 alpha-2 code ("Kenya" -> "KE"), for starting a phone number's country picker on
// the country a partner serves in. Not countryFipsCodes.js: FIPS 10-4 disagrees with ISO for many countries
// (Philippines is RP there and PH here), and phone numbers are keyed by ISO. Covers every country a phone
// number can belong to, under the browser's English name for it plus the names the address form's country list
// uses (countryContinents.js) and a few everyday short forms.

const ALIASES = {
  "antigua and barbuda": "AG",
  "bosnia and herzegovina": "BA",
  burma: "MM",
  myanmar: "MM",
  congo: "CG",
  "republic of the congo": "CG",
  "dr congo": "CD",
  drc: "CD",
  "democratic republic of the congo": "CD",
  "czech republic": "CZ",
  "hong kong": "HK",
  "ivory coast": "CI",
  macau: "MO",
  macedonia: "MK",
  palestine: "PS",
  "saint barthelemy": "BL",
  "saint helena, ascension and tristan da cunha": "SH",
  "saint kitts and nevis": "KN",
  "saint lucia": "LC",
  "saint martin": "MF",
  "saint pierre and miquelon": "PM",
  "saint vincent and the grenadines": "VC",
  "sao tome and principe": "ST",
  "svalbard and jan mayen": "SJ",
  swaziland: "SZ",
  "trinidad and tobago": "TT",
  turkey: "TR",
  "turks and caicos islands": "TC",
  "united states virgin islands": "VI",
  "wallis and futuna": "WF",
  usa: "US",
  us: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "south korea": "KR",
  korea: "KR",
  "north korea": "KP",
  russia: "RU",
  uae: "AE",
  "the gambia": "GM",
  "the bahamas": "BS",
  "the netherlands": "NL",
  "the philippines": "PH",
  holland: "NL",
};

// "São Tomé & Príncipe", "St. Lucia" and "SAINT LUCIA " all compare equal to "saint lucia".
function key(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_NAME = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const map = new Map();
  for (const code of getCountries()) {
    const name = names.of(code);
    if (name && name !== code) map.set(key(name), code);
  }
  for (const [name, code] of Object.entries(ALIASES)) map.set(key(name), code);
  return map;
})();

// The ISO code for a country name as typed in an address, or null when it isn't one we know (then the caller
// keeps its own default). A two-letter ISO code is accepted as it is.
export function isoCountryCode(name) {
  const k = key(name);
  if (!k) return null;
  const found = BY_NAME.get(k);
  if (found) return found;
  const upper = k.toUpperCase();
  return k.length === 2 && getCountries().includes(upper) ? upper : null;
}
