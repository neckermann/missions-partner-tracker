// Forward-geocodes a physical address into { lat, lng } with OpenStreetMap
// Nominatim (free, no key). A save-time convenience: on failure callers leave
// gpsLat/gpsLng null rather than block the save.
//
// Geocodes city/state/country only, never the street line, so public map pins land
// on the nearest city.
// Nominatim's usage policy requires a real contact in the User-Agent: set
// NOMINATIM_CONTACT to your own email before deploying a fork.
const USER_AGENT = `MissionsPartnerTracker/1.0 (contact: ${process.env.NOMINATIM_CONTACT || "nicholas.eckermann@gmail.com"})`;

async function geocodeAddress({ city, stateProvinceRegion, country } = {}) {
  const query = [city, stateProvinceRegion, country].filter(Boolean).join(", ");
  if (!query) return null;

  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "jsonv2",
    q: query,
    limit: "1",
  })}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    // A malformed upstream result (missing/non-numeric lat or lon) leaves gpsLat/gpsLng null, not NaN.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.error("Geocoding failed:", err);
    return null;
  }
}

module.exports = { geocodeAddress };
