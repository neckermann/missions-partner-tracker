const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { geocodeAddress } = require("../src/utils/geocode");

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetch(body, ok = true) {
  global.fetch = async () => ({ ok, json: async () => body });
}

describe("geocodeAddress", () => {
  test("returns lat/lng from a real result", async () => {
    mockFetch([{ lat: "41.8781", lon: "-87.6298" }]);
    const result = await geocodeAddress({ city: "Chicago", country: "USA" });
    assert.deepEqual(result, { lat: 41.8781, lng: -87.6298 });
  });

  test("returns null rather than NaN for a malformed upstream result", async () => {
    // A real-world malformed response: missing lat, or a non-numeric
    // value -- same "leave gpsLat/gpsLng null" fallback as finding
    // nothing at all, not a NaN that silently gets persisted.
    mockFetch([{ lon: "-87.6298" }]); // lat missing entirely
    assert.equal(await geocodeAddress({ city: "Chicago", country: "USA" }), null);

    mockFetch([{ lat: "not-a-number", lon: "-87.6298" }]);
    assert.equal(await geocodeAddress({ city: "Chicago", country: "USA" }), null);
  });

  test("returns null when nothing is found", async () => {
    mockFetch([]);
    assert.equal(await geocodeAddress({ city: "Nowhere", country: "Nowhere" }), null);
  });

  test("returns null on a non-ok response", async () => {
    mockFetch({}, false);
    assert.equal(await geocodeAddress({ city: "Chicago", country: "USA" }), null);
  });

  test("returns null without calling out when there's nothing to query", async () => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { ok: true, json: async () => [] };
    };
    assert.equal(await geocodeAddress({}), null);
    assert.equal(called, false);
  });
});
