// Forward-geocodes a physical address into { lat, lng } using OpenStreetMap
// Nominatim (free, no API key). Used as a save-time convenience — if it
// fails or finds nothing, callers should just leave gpsLat/gpsLng null
// rather than blocking the save.
//
// Deliberately geocodes to city/state/country only, never the street
// address line — public map pins should land on the nearest city, not an
// exact street address, even when a full address is on file for internal
// reference.
// Nominatim's usage policy requires a real contact in the User-Agent so
// misbehaving traffic can be reached instead of just blocked — set
// NOMINATIM_CONTACT to your own email before deploying a fork, so requests
// aren't attributed to this project's original author.
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
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch (err) {
    console.error("Geocoding failed:", err);
    return null;
  }
}

module.exports = { geocodeAddress };
