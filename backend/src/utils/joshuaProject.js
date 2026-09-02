// Server-side proxy for the Joshua Project API so the API key never reaches
// the browser. Country-level stats only for now (population, primary
// religion, % Christian/Evangelical, JP Scale).
const DOMAIN = "https://api.joshuaproject.net";

// Country demographic stats barely change and several missionaries often
// share a country, so a simple in-memory cache avoids hammering the API.
// This endpoint is public and unauthenticated, so the cache key
// (countryCode) is attacker-controlled — bounded below so scraping/abuse
// with arbitrary junk values can't grow it unbounded for a full 24h TTL.
const cache = new Map(); // countryCode -> { data, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500; // generous multiple of realistic country-code count
// FIPS/ISO country codes are short alphanumeric strings — this also rejects
// obvious junk before it ever reaches the cache or the upstream API.
const COUNTRY_CODE_PATTERN = /^[A-Za-z0-9]{1,4}$/;

async function getCountryInfo(countryCode) {
  if (!countryCode || !COUNTRY_CODE_PATTERN.test(countryCode)) return null;

  const cached = cache.get(countryCode);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict the oldest entry (Map iteration order = insertion order).
    cache.delete(cache.keys().next().value);
  }

  const apiKey = process.env.JOSHUA_PROJECT_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `${DOMAIN}/v1/countries/${encodeURIComponent(countryCode)}.json?api_key=${apiKey}`
    );
    if (!res.ok) return null;
    const results = await res.json();
    // The API returns an array (e.g. [{ Ctry, Population, ... }]), not a
    // bare object — grab the single country record out of it.
    const data = Array.isArray(results) ? results[0] || null : results;
    cache.set(countryCode, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error("Joshua Project lookup failed:", err);
    return null;
  }
}

module.exports = { getCountryInfo };
