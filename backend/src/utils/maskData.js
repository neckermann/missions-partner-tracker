/**
 * Turns a name into initials, e.g. "Jordan Rivera" -> "J.R."
 */
function toInitials(fullName = "") {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + ".")
    .join("");
}

// Country-level fallback pin for restricted missionaries, keyed by the
// country name resolved on their physical address. Covers every country
// (source: mledoze/countries, MIT-licensed, github.com/mledoze/countries),
// plus a handful of common-usage aliases (e.g. "Turkey" alongside the
// official "Türkiye") for names people are likely to type differently
// than the canonical form below.
//
// `physical.country` is free text (AddressFields.jsx has no country
// picker), so this is still an exact-string match — a restricted
// missionary whose country was typed in some other form (a typo, a
// different spelling, "USA" instead of "United States", etc.) won't match
// and will get no pin at all, same failure mode as before this list was
// filled out, just less likely to hit now that it's comprehensive rather
// than 4 countries.
const COUNTRY_CENTROIDS = {
  Afghanistan: { lat: 33, lng: 65 },
  "Åland Islands": { lat: 60.116667, lng: 19.9 },
  Albania: { lat: 41, lng: 20 },
  Algeria: { lat: 28, lng: 3 },
  "American Samoa": { lat: -14.33333333, lng: -170 },
  Andorra: { lat: 42.5, lng: 1.5 },
  Angola: { lat: -12.5, lng: 18.5 },
  Anguilla: { lat: 18.25, lng: -63.16666666 },
  Antarctica: { lat: -90, lng: 0 },
  "Antigua and Barbuda": { lat: 17.05, lng: -61.8 },
  Argentina: { lat: -34, lng: -64 },
  Armenia: { lat: 40, lng: 45 },
  Aruba: { lat: 12.5, lng: -69.96666666 },
  Australia: { lat: -27, lng: 133 },
  Austria: { lat: 47.33333333, lng: 13.33333333 },
  Azerbaijan: { lat: 40.5, lng: 47.5 },
  Bahamas: { lat: 24.25, lng: -76 },
  Bahrain: { lat: 26, lng: 50.55 },
  Bangladesh: { lat: 24, lng: 90 },
  Barbados: { lat: 13.16666666, lng: -59.53333333 },
  Belarus: { lat: 53, lng: 28 },
  Belgium: { lat: 50.83333333, lng: 4 },
  Belize: { lat: 17.25, lng: -88.75 },
  Benin: { lat: 9.5, lng: 2.25 },
  Bermuda: { lat: 32.33333333, lng: -64.75 },
  Bhutan: { lat: 27.5, lng: 90.5 },
  Bolivia: { lat: -17, lng: -65 },
  "Bosnia and Herzegovina": { lat: 44, lng: 18 },
  Botswana: { lat: -22, lng: 24 },
  "Bouvet Island": { lat: -54.43333333, lng: 3.4 },
  Brazil: { lat: -10, lng: -55 },
  "British Indian Ocean Territory": { lat: -6, lng: 71.5 },
  "British Virgin Islands": { lat: 18.431383, lng: -64.62305 },
  Brunei: { lat: 4.5, lng: 114.66666666 },
  Bulgaria: { lat: 43, lng: 25 },
  "Burkina Faso": { lat: 13, lng: -2 },
  Burundi: { lat: -3.5, lng: 30 },
  Cambodia: { lat: 13, lng: 105 },
  Cameroon: { lat: 6, lng: 12 },
  Canada: { lat: 60, lng: -95 },
  "Cape Verde": { lat: 16, lng: -24 },
  "Caribbean Netherlands": { lat: 12.18, lng: -68.25 },
  "Cayman Islands": { lat: 19.5, lng: -80.5 },
  "Central African Republic": { lat: 7, lng: 21 },
  Chad: { lat: 15, lng: 19 },
  Chile: { lat: -30, lng: -71 },
  China: { lat: 35, lng: 105 },
  "Christmas Island": { lat: -10.5, lng: 105.66666666 },
  "Cocos (Keeling) Islands": { lat: -12.5, lng: 96.83333333 },
  Colombia: { lat: 4, lng: -72 },
  Comoros: { lat: -12.16666666, lng: 44.25 },
  Congo: { lat: -1, lng: 15 },
  "Cook Islands": { lat: -21.23333333, lng: -159.76666666 },
  "Costa Rica": { lat: 10, lng: -84 },
  Croatia: { lat: 45.16666666, lng: 15.5 },
  Cuba: { lat: 21.5, lng: -80 },
  "Curaçao": { lat: 12.116667, lng: -68.933333 },
  Cyprus: { lat: 35, lng: 33 },
  Czechia: { lat: 49.75, lng: 15.5 },
  "Czech Republic": { lat: 49.75, lng: 15.5 }, // common alias for Czechia
  Denmark: { lat: 56, lng: 10 },
  Djibouti: { lat: 11.5, lng: 43 },
  Dominica: { lat: 15.41666666, lng: -61.33333333 },
  "Dominican Republic": { lat: 19, lng: -70.66666666 },
  "DR Congo": { lat: 0, lng: 25 },
  "Democratic Republic of the Congo": { lat: 0, lng: 25 }, // common alternate for DR Congo
  Ecuador: { lat: -2, lng: -77.5 },
  Egypt: { lat: 27, lng: 30 },
  "El Salvador": { lat: 13.83333333, lng: -88.91666666 },
  "Equatorial Guinea": { lat: 2, lng: 10 },
  Eritrea: { lat: 15, lng: 39 },
  Estonia: { lat: 59, lng: 26 },
  Eswatini: { lat: -26.5, lng: 31.5 },
  Swaziland: { lat: -26.5, lng: 31.5 }, // former name of Eswatini
  Ethiopia: { lat: 8, lng: 38 },
  "Falkland Islands": { lat: -51.75, lng: -59 },
  "Faroe Islands": { lat: 62, lng: -7 },
  Fiji: { lat: -18, lng: 175 },
  Finland: { lat: 64, lng: 26 },
  France: { lat: 46, lng: 2 },
  "French Guiana": { lat: 4, lng: -53 },
  "French Polynesia": { lat: -15, lng: -140 },
  "French Southern and Antarctic Lands": { lat: -49.25, lng: 69.167 },
  Gabon: { lat: -1, lng: 11.75 },
  Gambia: { lat: 13.46666666, lng: -16.56666666 },
  Georgia: { lat: 42, lng: 43.5 },
  Germany: { lat: 51, lng: 9 },
  Ghana: { lat: 8, lng: -2 },
  Gibraltar: { lat: 36.13333333, lng: -5.35 },
  Greece: { lat: 39, lng: 22 },
  Greenland: { lat: 72, lng: -40 },
  Grenada: { lat: 12.11666666, lng: -61.66666666 },
  Guadeloupe: { lat: 16.25, lng: -61.583333 },
  Guam: { lat: 13.46666666, lng: 144.78333333 },
  Guatemala: { lat: 15.5, lng: -90.25 },
  Guernsey: { lat: 49.46666666, lng: -2.58333333 },
  Guinea: { lat: 11, lng: -10 },
  "Guinea-Bissau": { lat: 12, lng: -15 },
  Guyana: { lat: 5, lng: -59 },
  Haiti: { lat: 19, lng: -72.41666666 },
  "Heard Island and McDonald Islands": { lat: -53.1, lng: 72.51666666 },
  Honduras: { lat: 15, lng: -86.5 },
  "Hong Kong": { lat: 22.267, lng: 114.188 },
  Hungary: { lat: 47, lng: 20 },
  Iceland: { lat: 65, lng: -18 },
  India: { lat: 20, lng: 77 },
  Indonesia: { lat: -5, lng: 120 },
  Iran: { lat: 32, lng: 53 },
  Iraq: { lat: 33, lng: 44 },
  Ireland: { lat: 53, lng: -8 },
  "Isle of Man": { lat: 54.25, lng: -4.5 },
  Israel: { lat: 31.47, lng: 35.13 },
  Italy: { lat: 42.83333333, lng: 12.83333333 },
  "Ivory Coast": { lat: 8, lng: -5 },
  Jamaica: { lat: 18.25, lng: -77.5 },
  Japan: { lat: 36, lng: 138 },
  Jersey: { lat: 49.25, lng: -2.16666666 },
  Jordan: { lat: 31, lng: 36 },
  Kazakhstan: { lat: 48, lng: 68 },
  Kenya: { lat: 1, lng: 38 },
  Kiribati: { lat: 1.41666666, lng: 173 },
  Kosovo: { lat: 42.666667, lng: 21.166667 },
  Kuwait: { lat: 29.5, lng: 45.75 },
  Kyrgyzstan: { lat: 41, lng: 75 },
  Laos: { lat: 18, lng: 105 },
  Latvia: { lat: 57, lng: 25 },
  Lebanon: { lat: 33.83333333, lng: 35.83333333 },
  Lesotho: { lat: -29.5, lng: 28.5 },
  Liberia: { lat: 6.5, lng: -9.5 },
  Libya: { lat: 25, lng: 17 },
  Liechtenstein: { lat: 47.26666666, lng: 9.53333333 },
  Lithuania: { lat: 56, lng: 24 },
  Luxembourg: { lat: 49.75, lng: 6.16666666 },
  Macau: { lat: 22.16666666, lng: 113.55 },
  Madagascar: { lat: -20, lng: 47 },
  Malawi: { lat: -13.5, lng: 34 },
  Malaysia: { lat: 2.5, lng: 112.5 },
  Maldives: { lat: 3.25, lng: 73 },
  Mali: { lat: 17, lng: -4 },
  Malta: { lat: 35.83333333, lng: 14.58333333 },
  "Marshall Islands": { lat: 9, lng: 168 },
  Martinique: { lat: 14.666667, lng: -61 },
  Mauritania: { lat: 20, lng: -12 },
  Mauritius: { lat: -20.28333333, lng: 57.55 },
  Mayotte: { lat: -12.83333333, lng: 45.16666666 },
  Mexico: { lat: 23, lng: -102 },
  Micronesia: { lat: 6.91666666, lng: 158.25 },
  Moldova: { lat: 47, lng: 29 },
  Monaco: { lat: 43.73333333, lng: 7.4 },
  Mongolia: { lat: 46, lng: 105 },
  Montenegro: { lat: 42.5, lng: 19.3 },
  Montserrat: { lat: 16.75, lng: -62.2 },
  Morocco: { lat: 32, lng: -5 },
  Mozambique: { lat: -18.25, lng: 35 },
  Myanmar: { lat: 22, lng: 98 },
  Burma: { lat: 22, lng: 98 }, // common alias for Myanmar
  Namibia: { lat: -22, lng: 17 },
  Nauru: { lat: -0.53333333, lng: 166.91666666 },
  Nepal: { lat: 28, lng: 84 },
  Netherlands: { lat: 52.5, lng: 5.75 },
  "New Caledonia": { lat: -21.5, lng: 165.5 },
  "New Zealand": { lat: -41, lng: 174 },
  Nicaragua: { lat: 13, lng: -85 },
  Niger: { lat: 16, lng: 8 },
  Nigeria: { lat: 10, lng: 8 },
  Niue: { lat: -19.03333333, lng: -169.86666666 },
  "Norfolk Island": { lat: -29.03333333, lng: 167.95 },
  "North Korea": { lat: 40, lng: 127 },
  "North Macedonia": { lat: 41.83333333, lng: 22 },
  Macedonia: { lat: 41.83333333, lng: 22 }, // former name of North Macedonia
  "Northern Mariana Islands": { lat: 15.2, lng: 145.75 },
  Norway: { lat: 62, lng: 10 },
  Oman: { lat: 21, lng: 57 },
  Pakistan: { lat: 30, lng: 70 },
  Palau: { lat: 7.5, lng: 134.5 },
  Palestine: { lat: 31.9, lng: 35.2 },
  Panama: { lat: 9, lng: -80 },
  "Papua New Guinea": { lat: -6, lng: 147 },
  Paraguay: { lat: -23, lng: -58 },
  Peru: { lat: -10, lng: -76 },
  Philippines: { lat: 13, lng: 122 },
  "Pitcairn Islands": { lat: -25.06666666, lng: -130.1 },
  Poland: { lat: 52, lng: 20 },
  Portugal: { lat: 39.5, lng: -8 },
  "Puerto Rico": { lat: 18.25, lng: -66.5 },
  Qatar: { lat: 25.5, lng: 51.25 },
  Réunion: { lat: -21.15, lng: 55.5 },
  Romania: { lat: 46, lng: 25 },
  Russia: { lat: 60, lng: 100 },
  Rwanda: { lat: -2, lng: 30 },
  "Saint Barthélemy": { lat: 18.5, lng: -63.41666666 },
  "Saint Helena, Ascension and Tristan da Cunha": { lat: -15.95, lng: -5.72 },
  "Saint Kitts and Nevis": { lat: 17.33333333, lng: -62.75 },
  "Saint Lucia": { lat: 13.88333333, lng: -60.96666666 },
  "Saint Martin": { lat: 18.08333333, lng: -63.95 },
  "Saint Pierre and Miquelon": { lat: 46.83333333, lng: -56.33333333 },
  "Saint Vincent and the Grenadines": { lat: 13.25, lng: -61.2 },
  Samoa: { lat: -13.58333333, lng: -172.33333333 },
  "San Marino": { lat: 43.76666666, lng: 12.41666666 },
  "São Tomé and Príncipe": { lat: 1, lng: 7 },
  "Saudi Arabia": { lat: 25, lng: 45 },
  Senegal: { lat: 14, lng: -14 },
  Serbia: { lat: 44, lng: 21 },
  Seychelles: { lat: -4.58333333, lng: 55.66666666 },
  "Sierra Leone": { lat: 8.5, lng: -11.5 },
  Singapore: { lat: 1.36666666, lng: 103.8 },
  "Sint Maarten": { lat: 18.033333, lng: -63.05 },
  Slovakia: { lat: 48.66666666, lng: 19.5 },
  Slovenia: { lat: 46.11666666, lng: 14.81666666 },
  "Solomon Islands": { lat: -8, lng: 159 },
  Somalia: { lat: 10, lng: 49 },
  "South Africa": { lat: -29, lng: 24 },
  "South Georgia": { lat: -54.5, lng: -37 },
  "South Korea": { lat: 37, lng: 127.5 },
  "South Sudan": { lat: 7, lng: 30 },
  Spain: { lat: 40, lng: -4 },
  "Sri Lanka": { lat: 7, lng: 81 },
  Sudan: { lat: 15, lng: 30 },
  Suriname: { lat: 4, lng: -56 },
  "Svalbard and Jan Mayen": { lat: 78, lng: 20 },
  Sweden: { lat: 62, lng: 15 },
  Switzerland: { lat: 47, lng: 8 },
  Syria: { lat: 35, lng: 38 },
  Taiwan: { lat: 23.5, lng: 121 },
  Tajikistan: { lat: 39, lng: 71 },
  Tanzania: { lat: -6, lng: 35 },
  Thailand: { lat: 15, lng: 100 },
  "Timor-Leste": { lat: -8.83333333, lng: 125.91666666 },
  Togo: { lat: 8, lng: 1.16666666 },
  Tokelau: { lat: -9, lng: -172 },
  Tonga: { lat: -20, lng: -175 },
  "Trinidad and Tobago": { lat: 11, lng: -61 },
  Tunisia: { lat: 34, lng: 9 },
  Türkiye: { lat: 39, lng: 35 },
  Turkey: { lat: 39, lng: 35 }, // common alias for Türkiye
  Turkmenistan: { lat: 40, lng: 60 },
  "Turks and Caicos Islands": { lat: 21.75, lng: -71.58333333 },
  Tuvalu: { lat: -8, lng: 178 },
  Uganda: { lat: 1, lng: 32 },
  Ukraine: { lat: 49, lng: 32 },
  "United Arab Emirates": { lat: 24, lng: 54 },
  "United Kingdom": { lat: 54, lng: -2 },
  "United States": { lat: 38, lng: -97 },
  "United States Minor Outlying Islands": { lat: 19.3, lng: 166.633333 },
  "United States Virgin Islands": { lat: 18.35, lng: -64.933333 },
  Uruguay: { lat: -33, lng: -56 },
  Uzbekistan: { lat: 41, lng: 64 },
  Vanuatu: { lat: -16, lng: 167 },
  "Vatican City": { lat: 41.9, lng: 12.45 },
  Venezuela: { lat: 8, lng: -66 },
  Vietnam: { lat: 16.16666666, lng: 107.83333333 },
  "Wallis and Futuna": { lat: -13.3, lng: -176.2 },
  "Western Sahara": { lat: 24.5, lng: -13 },
  Yemen: { lat: 15, lng: 48 },
  Zambia: { lat: -15, lng: 30 },
  Zimbabwe: { lat: -20, lng: 30 },
};

/**
 * Given a full Missionary record (with relations included), return the
 * shape that is safe to send to the PUBLIC website, based on isPublic /
 * isRestricted flags.
 *
 * - isPublic = false          -> return null (caller should filter these out)
 * - isPublic = true, restricted = false -> full "public" fields, still
 *      excludes internal-only data (emergency contacts, raw phone/email
 *      unless explicitly marked contactSafe, internal notes, user ids)
 * - isPublic = true, restricted = true  -> heavily generic: initials only,
 *      a country-level pin only (never the precise serving-location
 *      coordinates), no contact info, no children data, generic overview.
 */
function toPublicMissionary(m) {
  if (!m || !m.isPublic || m.archived) return null;

  const physical = (m.addresses || []).find((a) => a.type === "physical");

  const base = {
    id: m.id,
    fieldDisplayName: m.fieldDisplayName,
    supportingSince: m.supportingSince,
    // Country code (not name) for looking up Joshua Project stats. Fine to
    // expose even when restricted — it's the same country-level granularity
    // already shown via the masked `country` field below.
    fipsCountryCode: m.fipsCountryCode || null,
  };

  if (m.isRestricted) {
    const centroid = physical?.country ? COUNTRY_CENTROIDS[physical.country] : null;
    return {
      ...base,
      isRestricted: true,
      displayName: toInitials(m.displayName),
      // Coarsen location to a country-level pin only — never the precise
      // serving-location coordinates.
      country: physical?.country || m.fipsCountryCode || null,
      gpsLat: centroid?.lat ?? null,
      gpsLng: centroid?.lng ?? null,
      overviewShort: "Restricted-access location.",
      overview: "Serving in a restricted-access location. Specific details are withheld for security.",
    };
  }

  // Public, not restricted -> fuller (but still curated) view
  return {
    ...base,
    displayName: m.displayName,
    // Same country-level value as the restricted branch above (already
    // considered safe to expose there) — needed for the country/continent
    // filters and search on the public directory, not just restricted
    // records.
    country: physical?.country || m.fipsCountryCode || null,
    gpsLat: physical?.gpsLat ?? null,
    gpsLng: physical?.gpsLng ?? null,
    overview: m.overview,
    overviewShort: m.overviewShort,
    focusArea: m.focusArea,
    websiteLink: m.websiteLink,
    supportLink: m.supportLink,
    newsletterSignup: m.newsletterSignup,
    facebook: m.facebook,
    twitter: m.twitter,
    instagram: m.instagram,
    linkedin: m.linkedin,
    languagesSpoken: m.languagesSpoken,
    // Only the current photo (see Photo model / publicMissionaries.js's
    // `take: 1` include) is ever surfaced publicly — never the upload
    // history, and never at all for a restricted record (see above).
    photo: m.photos?.[0]?.url ?? null,
    sendingChurch: m.sendingChurch ? { name: m.sendingChurch.name } : null,
    sendingOrg: m.sendingOrg ? { name: m.sendingOrg.name } : null,
  };
}

/**
 * Same isPublic/isRestricted masking philosophy as toPublicMissionary, for
 * Organization records. Unlike a restricted missionary, a restricted org's
 * `name` stays visible — it's an institution, not a person, so there's no
 * equivalent privacy reason to reduce it to initials. Only its precise
 * location/contact info gets stripped.
 */
function toPublicOrganization(o) {
  if (!o || !o.isPublic || o.archived) return null;

  const physical = (o.addresses || []).find((a) => a.type === "physical");

  const base = {
    id: o.id,
    name: o.name,
    orgType: o.orgType,
    fieldDisplayName: o.fieldDisplayName,
    supportingSince: o.supportingSince,
    fipsCountryCode: o.fipsCountryCode || null,
  };

  if (o.isRestricted) {
    const centroid = physical?.country ? COUNTRY_CENTROIDS[physical.country] : null;
    return {
      ...base,
      isRestricted: true,
      country: physical?.country || o.fipsCountryCode || null,
      gpsLat: centroid?.lat ?? null,
      gpsLng: centroid?.lng ?? null,
      overviewShort: "Restricted-access location.",
      overview: "Partnering in a restricted-access location. Specific details are withheld for security.",
    };
  }

  return {
    ...base,
    // Same country-level value as the restricted branch above.
    country: physical?.country || o.fipsCountryCode || null,
    gpsLat: physical?.gpsLat ?? null,
    gpsLng: physical?.gpsLng ?? null,
    overview: o.overview,
    overviewShort: o.overviewShort,
    focusArea: o.focusArea,
    websiteLink: o.websiteLink,
    supportLink: o.supportLink,
    newsletterSignup: o.newsletterSignup,
    facebook: o.facebook,
    twitter: o.twitter,
    instagram: o.instagram,
    linkedin: o.linkedin,
    photo: o.photos?.[0]?.url ?? null,
  };
}

module.exports = { toInitials, toPublicMissionary, toPublicOrganization };
