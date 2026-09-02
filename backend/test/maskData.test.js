const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { toInitials, toPublicMissionary, toPublicOrganization } = require("../src/utils/maskData");

describe("toInitials", () => {
  test("converts a full name to initials", () => {
    assert.equal(toInitials("Jordan Rivera"), "J.R.");
  });

  test("handles a single name", () => {
    assert.equal(toInitials("Cher"), "C.");
  });

  test("handles extra whitespace between names", () => {
    assert.equal(toInitials("  Jordan   Rivera  "), "J.R.");
  });

  test("handles an empty/missing name without throwing", () => {
    assert.equal(toInitials(""), "");
    assert.equal(toInitials(undefined), "");
  });
});

// A private-only baseline record — every test below overrides isPublic
// and/or isRestricted on top of this, so a forgotten field never
// accidentally makes a test pass by coincidence.
function baseMissionary(overrides = {}) {
  return {
    id: "m1",
    isPublic: true,
    isRestricted: false,
    archived: false,
    displayName: "Jordan Rivera",
    fieldDisplayName: "Southeast Asia",
    fipsCountryCode: "TH",
    overview: "Full public overview.",
    overviewShort: "Short overview.",
    focusArea: "Church planting",
    addresses: [{ type: "physical", country: "Thailand", gpsLat: 13.75, gpsLng: 100.5 }],
    sendingChurch: { name: "First Church", contactEmail: "sensitive@example.com" },
    sendingOrg: { name: "Some Agency", contactEmail: "sensitive@example.com" },
    emergencyContact: { name: "Someone", phone: "555-1234" },
    children: [{ name: "Kid One", birthdate: "2015-01-01" }],
    // Pre-sorted newest-first, matching missionaryInclude's orderBy — [0] is
    // "current." Older entries exist only to prove they're never exposed.
    photos: [
      { id: "p2", url: "https://example.com/current.jpg", receivedDate: "2026-01-01" },
      { id: "p1", url: "https://example.com/old.jpg", receivedDate: "2025-01-01" },
    ],
    ...overrides,
  };
}

describe("toPublicMissionary", () => {
  test("returns null when not public", () => {
    assert.equal(toPublicMissionary(baseMissionary({ isPublic: false })), null);
  });

  test("returns null when archived, even if public", () => {
    assert.equal(toPublicMissionary(baseMissionary({ archived: true })), null);
  });

  test("returns null for a missing/undefined record", () => {
    assert.equal(toPublicMissionary(null), null);
    assert.equal(toPublicMissionary(undefined), null);
  });

  test("public, non-restricted: exposes the real name and precise location", () => {
    const result = toPublicMissionary(baseMissionary());
    assert.equal(result.displayName, "Jordan Rivera");
    assert.equal(result.gpsLat, 13.75);
    assert.equal(result.gpsLng, 100.5);
    assert.equal(result.overview, "Full public overview.");
    assert.equal(result.isRestricted, undefined);
  });

  // Regression test: this field was only ever set on the isRestricted
  // branch, so every non-restricted record (the majority of real data)
  // came back with country === undefined — silently breaking the public
  // directory's continent/country filters and search, since they rely on
  // this field for every record, not just restricted ones.
  test("public, non-restricted: still exposes the country field", () => {
    const result = toPublicMissionary(baseMissionary());
    assert.equal(result.country, "Thailand");
  });

  test("public, non-restricted: falls back to the FIPS code when the address has no country", () => {
    const result = toPublicMissionary(
      baseMissionary({ addresses: [{ type: "physical", gpsLat: 13.75, gpsLng: 100.5 }] })
    );
    assert.equal(result.country, "TH");
  });

  // Regression coverage for the photo-history feature: only the current
  // (photos[0]) photo is ever exposed publicly, never the older ones, and
  // never at all for a restricted record (children/contact/sending party
  // are already covered above for the same reason -- photo belongs in that
  // same "strips everything identifying" list).
  test("public, non-restricted: exposes only the current photo, not history", () => {
    const result = toPublicMissionary(baseMissionary());
    assert.equal(result.photo, "https://example.com/current.jpg");
  });

  test("public, non-restricted: photo is null when no photos exist", () => {
    const result = toPublicMissionary(baseMissionary({ photos: [] }));
    assert.equal(result.photo, null);
  });

  test("restricted: never exposes a photo, current or otherwise", () => {
    const result = toPublicMissionary(baseMissionary({ isRestricted: true }));
    assert.equal(result.photo, undefined);
  });

  test("public, non-restricted: never leaks internal-only fields", () => {
    const result = toPublicMissionary(baseMissionary());
    assert.equal(result.emergencyContact, undefined);
    assert.equal(result.children, undefined);
    // sendingChurch/sendingOrg are curated down to just a name, never the
    // full sub-record (which carries contact info).
    assert.deepEqual(result.sendingChurch, { name: "First Church" });
    assert.deepEqual(result.sendingOrg, { name: "Some Agency" });
  });

  test("restricted: reduces the name to initials", () => {
    const result = toPublicMissionary(baseMissionary({ isRestricted: true }));
    assert.equal(result.displayName, "J.R.");
  });

  test("restricted: replaces precise GPS with a country-level centroid", () => {
    const result = toPublicMissionary(baseMissionary({ isRestricted: true }));
    // Thailand's centroid from COUNTRY_CENTROIDS, not the precise 13.75/100.5
    // serving-location coordinates from the address.
    assert.equal(result.gpsLat, 15);
    assert.equal(result.gpsLng, 100);
  });

  test("restricted: falls back to a null pin for a country with no known centroid", () => {
    const record = baseMissionary({
      isRestricted: true,
      addresses: [{ type: "physical", country: "Narnia", gpsLat: 1, gpsLng: 1 }],
    });
    const result = toPublicMissionary(record);
    assert.equal(result.gpsLat, null);
    assert.equal(result.gpsLng, null);
  });

  test("restricted: replaces the overview with a generic security blurb", () => {
    const result = toPublicMissionary(baseMissionary({ isRestricted: true }));
    assert.equal(result.overview, "Serving in a restricted-access location. Specific details are withheld for security.");
    assert.equal(result.overviewShort, "Restricted-access location.");
  });

  test("restricted: strips contact info, sending church/org, and children entirely", () => {
    const result = toPublicMissionary(baseMissionary({ isRestricted: true }));
    assert.equal(result.sendingChurch, undefined);
    assert.equal(result.sendingOrg, undefined);
    assert.equal(result.children, undefined);
    assert.equal(result.emergencyContact, undefined);
    assert.equal(result.websiteLink, undefined);
    assert.equal(result.facebook, undefined);
  });
});

function baseOrganization(overrides = {}) {
  return {
    id: "o1",
    isPublic: true,
    isRestricted: false,
    archived: false,
    name: "Example Relief Org",
    orgType: "NGO",
    fieldDisplayName: "East Africa",
    overview: "Full public overview.",
    overviewShort: "Short overview.",
    addresses: [{ type: "physical", country: "India", gpsLat: 20.1, gpsLng: 78.2 }],
    photos: [
      { id: "p2", url: "https://example.com/current-logo.jpg", receivedDate: "2026-01-01" },
      { id: "p1", url: "https://example.com/old-logo.jpg", receivedDate: "2025-01-01" },
    ],
    ...overrides,
  };
}

describe("toPublicOrganization", () => {
  test("returns null when not public or archived", () => {
    assert.equal(toPublicOrganization(baseOrganization({ isPublic: false })), null);
    assert.equal(toPublicOrganization(baseOrganization({ archived: true })), null);
  });

  test("restricted: keeps the org name visible (unlike a restricted missionary)", () => {
    const result = toPublicOrganization(baseOrganization({ isRestricted: true }));
    assert.equal(result.name, "Example Relief Org");
  });

  test("restricted: still coarsens location and overview like a missionary", () => {
    const result = toPublicOrganization(baseOrganization({ isRestricted: true }));
    assert.equal(result.gpsLat, 20); // India's centroid, not 20.1
    assert.equal(result.overview, "Partnering in a restricted-access location. Specific details are withheld for security.");
  });

  test("public, non-restricted: exposes precise location", () => {
    const result = toPublicOrganization(baseOrganization());
    assert.equal(result.gpsLat, 20.1);
    assert.equal(result.gpsLng, 78.2);
  });

  // Regression test -- see the equivalent toPublicMissionary test above.
  test("public, non-restricted: still exposes the country field", () => {
    const result = toPublicOrganization(baseOrganization());
    assert.equal(result.country, "India");
  });

  // Regression coverage for the photo-history feature -- see the
  // equivalent toPublicMissionary tests above.
  test("public, non-restricted: exposes only the current photo, not history", () => {
    const result = toPublicOrganization(baseOrganization());
    assert.equal(result.photo, "https://example.com/current-logo.jpg");
  });

  test("restricted: never exposes a photo, current or otherwise", () => {
    const result = toPublicOrganization(baseOrganization({ isRestricted: true }));
    assert.equal(result.photo, undefined);
  });
});
