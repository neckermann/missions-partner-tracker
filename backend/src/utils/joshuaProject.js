// Server-side proxy for the Joshua Project API so the API key never reaches the
// browser. Country-level stats only (population, primary religion, % Christian/Evangelical, JP Scale).
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");

const DOMAIN = "https://api.joshuaproject.net";

// Country stats barely change and several partners share a country, so a simple
// in-memory cache avoids hammering the API. This endpoint is public and
// unauthenticated, so the cache key (countryCode) is attacker-controlled and bounded below.
const cache = new Map(); // countryCode -> { data, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// An empty lookup (shape-valid but nonexistent country code) is cached too, with a
// shorter TTL than a real hit, so it isn't re-fetched on every request yet a
// corrected code or catalog update isn't masked for a day.
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500; // generous multiple of realistic country-code count
// FIPS/ISO country codes are short alphanumeric strings; this rejects junk before it reaches the cache or upstream API.
const COUNTRY_CODE_PATTERN = /^[A-Za-z0-9]{1,4}$/;

async function getCountryInfo(countryCode) {
  if (!countryCode || !COUNTRY_CODE_PATTERN.test(countryCode)) return null;

  const cached = cache.get(countryCode);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict the oldest entry (Map iteration order = insertion order).
    cache.delete(cache.keys().next().value);
  }

  // Admin-managed in ChurchSettings; encrypted at rest like groupmeAccessToken.
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { joshuaProjectApiKey: true },
  });
  if (!settings?.joshuaProjectApiKey) return null;
  const apiKey = decryptField(settings.joshuaProjectApiKey);

  try {
    const res = await fetch(
      `${DOMAIN}/v1/countries/${encodeURIComponent(countryCode)}.json?api_key=${apiKey}`
    );
    if (!res.ok) return null;
    const results = await res.json();
    // A shape-valid code not in JP's catalog comes back as an empty array (not
    // an error); cache that negative result (NEGATIVE_CACHE_TTL_MS).
    if (Array.isArray(results) && results.length === 0) {
      cache.set(countryCode, { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
      return null;
    }
    // The API returns an array (e.g. [{ Ctry, Population, ... }]); take the single country record.
    const data = Array.isArray(results) ? results[0] || null : results;
    // A bad/expired API key can come back as a 200 with an error body; caching
    // that would mask the misconfiguration for 24h. Every real record has a
    // country name. Deliberately not cached at all, so a fixed key works on the next request.
    if (!data || typeof data.Ctry !== "string") return null;
    cache.set(countryCode, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error("Joshua Project lookup failed:", err);
    return null;
  }
}

module.exports = { getCountryInfo };
