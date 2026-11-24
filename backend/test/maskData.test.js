const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  toInitials,
  toPublicPartner,
  missionaryHouseholdCategory,
  maskedDisplayName,
} = require("../src/utils/maskData");

// Missionary and Organization merged into a single Partner model with a
// `kind` discriminator, so both fixtures below feed the same serializer.
// The describe blocks stay split by kind because the masking rules
// genuinely differ between them (initials vs. name, silhouette vs.
// building icon, missionary-only fields).

function isSilhouetteDataUri(value) {
  return typeof value === "string" && value.startsWith("data:image/svg+xml,");
}

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

// #327 Finding 10 -- shared by the public API, dispatch blurbs (GroupMe/
// WhatsApp/email), email digest tiles, trip pages, and shared report
// exports, so it's unit-tested directly rather than only indirectly
// through each of those callers.
describe("maskedDisplayName", () => {
  test("a non-restricted partner's real name passes through unchanged", () => {
    assert.equal(maskedDisplayName({ isRestricted: false, displayName: "Jordan Rivera" }), "Jordan Rivera");
  });

  test("restricted, no settings at all: defaults to initials (opt-out)", () => {
    assert.equal(maskedDisplayName({ isRestricted: true, displayName: "Jordan Rivera" }), "J.R.");
  });

  test("restricted, settings explicitly true: initials", () => {
    assert.equal(
      maskedDisplayName(
        { isRestricted: true, displayName: "Jordan Rivera" },
        { restrictedPartnerInitialsEnabled: true }
      ),
      "J.R."
    );
  });

  test("restricted, settings false, fieldDisplayName set: falls back to it", () => {
    assert.equal(
      maskedDisplayName(
        { isRestricted: true, displayName: "Jordan Rivera", fieldDisplayName: "Southeast Asia" },
        { restrictedPartnerInitialsEnabled: false }
      ),
      "Southeast Asia"
    );
  });

  test("restricted, settings false, no fieldDisplayName: falls back to the fixed generic label", () => {
    assert.equal(
      maskedDisplayName(
        { isRestricted: true, displayName: "Jordan Rivera", fieldDisplayName: null },
        { restrictedPartnerInitialsEnabled: false }
      ),
      "A restricted-access partner"
    );
  });

  test("a missing/undefined partner never throws", () => {
    assert.equal(maskedDisplayName(null), undefined);
    assert.equal(maskedDisplayName(undefined), undefined);
  });
});

// A private-only baseline record — every test below overrides isPublic
// and/or isRestricted on top of this, so a forgotten field never
// accidentally makes a test pass by coincidence.
function baseMissionary(overrides = {}) {
  return {
    id: "m1",
    kind: "missionary",
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
    emergencyContactName: "Someone",
    emergencyContactPhone: "555-1234",
    children: [{ name: "Kid One", birthdate: "2015-01-01" }],
    // Pre-sorted newest-first, matching missionaryInclude's orderBy — [0] is
    // "current." Older entries exist only to prove they're never exposed.
    photos: [
      { id: "p2", receivedDate: "2026-01-01" },
      { id: "p1", receivedDate: "2025-01-01" },
    ],
    ...overrides,
  };
}

describe("missionaryHouseholdCategory", () => {
  test("no adults recorded, no children -> single", () => {
    assert.equal(missionaryHouseholdCategory({}), "single");
  });
  test("one adult, no children -> single", () => {
    assert.equal(missionaryHouseholdCategory({ adults: [{ name: "Jordan" }] }), "single");
  });
  test("two adults, no children -> couple", () => {
    assert.equal(missionaryHouseholdCategory({ adults: [{ name: "Jordan" }, { name: "Alex" }] }), "couple");
  });
  test("any children at all -> family, regardless of adult count", () => {
    assert.equal(
      missionaryHouseholdCategory({ adults: [{ name: "Jordan" }], children: [{ name: "Kid" }] }),
      "family"
    );
    assert.equal(
      missionaryHouseholdCategory({
        adults: [{ name: "Jordan" }, { name: "Alex" }],
        children: [{ name: "Kid" }],
      }),
      "family"
    );
  });
});

describe("toPublicPartner — missionary", () => {
  test("returns null when not public", () => {
    assert.equal(toPublicPartner(baseMissionary({ isPublic: false })), null);
  });

  test("returns null when archived, even if public", () => {
    assert.equal(toPublicPartner(baseMissionary({ archived: true })), null);
  });

  test("returns null for a missing/undefined record", () => {
    assert.equal(toPublicPartner(null), null);
    assert.equal(toPublicPartner(undefined), null);
  });

  test("public, non-restricted: exposes the real name and precise location", () => {
    const result = toPublicPartner(baseMissionary());
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
    const result = toPublicPartner(baseMissionary());
    assert.equal(result.country, "Thailand");
  });

  // fipsCountryCode is for Joshua Project lookups only, deliberately not a
  // fallback for this field -- a record with no address country shows as
  // uncategorized on the public directory's filters rather than silently
  // inheriting whatever FIPS code happens to still be on the record (e.g.
  // left over from before the address country was cleared).
  test("public, non-restricted: country is null when the address has no country, even with a FIPS code on file", () => {
    const result = toPublicPartner(
      baseMissionary({ addresses: [{ type: "physical", gpsLat: 13.75, gpsLng: 100.5 }] })
    );
    assert.equal(result.country, null);
  });

  // Regression coverage for the photo-history feature: only the current
  // (photos[0]) photo is ever exposed publicly, never the older ones, and
  // never at all for a restricted record (children/contact/sending party
  // are already covered above for the same reason -- photo belongs in that
  // same "strips everything identifying" list).
  test("public, non-restricted: exposes only the current photo, not history", () => {
    const result = toPublicPartner(baseMissionary());
    assert.equal(result.photo, "/api/photos/p2/raw");
  });

  test("public, non-restricted: photo is null when no photos exist", () => {
    const result = toPublicPartner(baseMissionary({ photos: [] }));
    assert.equal(result.photo, null);
  });

  test("restricted: never exposes their real photo, current or otherwise — gets a generic silhouette instead", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true, photos: [{ id: "p1" }] }));
    assert.notEqual(result.photo, "/api/photos/p1/raw");
    assert.equal(isSilhouetteDataUri(result.photo), true);
  });

  test("public, non-restricted: never leaks internal-only fields", () => {
    const result = toPublicPartner(baseMissionary());
    assert.equal(result.emergencyContactName, undefined);
    assert.equal(result.emergencyContactPhone, undefined);
    assert.equal(result.emergencyContactEmail, undefined);
    assert.equal(result.children, undefined);
    // sendingChurch/sendingOrg are curated down to just a name, never the
    // full sub-record (which carries contact info).
    assert.deepEqual(result.sendingChurch, { name: "First Church" });
    assert.deepEqual(result.sendingOrg, { name: "Some Agency" });
  });

  test("restricted: reduces the name to initials", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }));
    assert.equal(result.displayName, "J.R.");
  });

  // #327 Finding 10 -- this used to assert the OPPOSITE: that a
  // restricted missionary's silhouette varied by real household
  // composition. That composition is itself identifying info, so every
  // restricted missionary now gets the same plain single-person shape
  // regardless of their actual household.
  test("restricted: silhouette photo is always the plain single-person shape, regardless of real household composition", () => {
    const single = toPublicPartner(
      baseMissionary({ isRestricted: true, adults: [{ name: "Jordan" }], children: [] })
    );
    const couple = toPublicPartner(
      baseMissionary({ isRestricted: true, adults: [{ name: "Jordan" }, { name: "Alex" }], children: [] })
    );
    const family = toPublicPartner(baseMissionary({ isRestricted: true })); // baseMissionary already has a child
    assert.equal(single.photo, couple.photo);
    assert.equal(couple.photo, family.photo);
  });

  // #327 Finding 10 -- supportingSince used to be returned unmasked even
  // for a restricted record, which combined with country and the masked
  // name narrows down a small country's expat community further than it
  // needs to.
  test("restricted: never exposes supportingSince", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true, supportingSince: "2014-01-01" }));
    assert.equal(result.supportingSince, null);
  });

  test("public, non-restricted: still exposes supportingSince", () => {
    const result = toPublicPartner(baseMissionary({ supportingSince: "2014-01-01" }));
    assert.equal(result.supportingSince, "2014-01-01");
  });

  // #327 Finding 10 -- restrictedPartnerInitialsEnabled defaults true
  // (opt-out), so omitting settings entirely (as every test above does)
  // must still produce initials, not silently fall back to a generic
  // label because settings was undefined.
  test("restricted: still reduces the name to initials with no settings object passed at all", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }), undefined);
    assert.equal(result.displayName, "J.R.");
  });

  test("restricted: falls back to fieldDisplayName when a church turns initials off", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }), {
      restrictedPartnerInitialsEnabled: false,
    });
    assert.equal(result.displayName, "Southeast Asia"); // baseMissionary's fieldDisplayName
  });

  test("restricted: falls back to a fixed generic label when initials are off and fieldDisplayName is also unset", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true, fieldDisplayName: null }), {
      restrictedPartnerInitialsEnabled: false,
    });
    assert.equal(result.displayName, "A restricted-access partner");
  });

  test("restricted: replaces precise GPS with a country-level centroid", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }));
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
    const result = toPublicPartner(record);
    assert.equal(result.gpsLat, null);
    assert.equal(result.gpsLng, null);
  });

  test("restricted: replaces the overview with a generic security blurb", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }));
    assert.equal(
      result.overview,
      "Serving in a restricted-access location. Specific details are withheld for security."
    );
    assert.equal(result.overviewShort, "Restricted-access location.");
  });

  test("restricted: strips contact info, sending church/org, and children entirely", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true }));
    assert.equal(result.sendingChurch, undefined);
    assert.equal(result.sendingOrg, undefined);
    assert.equal(result.children, undefined);
    assert.equal(result.emergencyContactName, undefined);
    assert.equal(result.emergencyContactPhone, undefined);
    assert.equal(result.emergencyContactEmail, undefined);
    assert.equal(result.links, undefined);
    assert.equal(result.languages, undefined);
  });
});

function baseOrganization(overrides = {}) {
  return {
    id: "o1",
    kind: "organization",
    isPublic: true,
    isRestricted: false,
    archived: false,
    displayName: "Example Relief Org",
    orgType: "NGO",
    fieldDisplayName: "East Africa",
    overview: "Full public overview.",
    overviewShort: "Short overview.",
    addresses: [{ type: "physical", country: "India", gpsLat: 20.1, gpsLng: 78.2 }],
    photos: [
      { id: "p2", receivedDate: "2026-01-01" },
      { id: "p1", receivedDate: "2025-01-01" },
    ],
    ...overrides,
  };
}

describe("toPublicPartner — organization", () => {
  test("returns null when not public or archived", () => {
    assert.equal(toPublicPartner(baseOrganization({ isPublic: false })), null);
    assert.equal(toPublicPartner(baseOrganization({ archived: true })), null);
  });

  // A named Christian organization in a hostile country is a fixed,
  // physically locatable target, so it gets the same name masking a
  // restricted missionary does. An earlier version left org names visible;
  // see the note on toPublicPartner for why that was the wrong call.
  test("restricted: reduces the org name to initials, same as a missionary", () => {
    const result = toPublicPartner(baseOrganization({ isRestricted: true }));
    assert.equal(result.displayName, "E.R.O.");
    assert.notEqual(result.displayName, "Example Relief Org");
  });

  test("restricted: still coarsens location and overview like a missionary", () => {
    const result = toPublicPartner(baseOrganization({ isRestricted: true }));
    assert.equal(result.gpsLat, 20); // India's centroid, not 20.1
    assert.equal(
      result.overview,
      "Partnering in a restricted-access location. Specific details are withheld for security."
    );
  });

  test("public, non-restricted: exposes precise location", () => {
    const result = toPublicPartner(baseOrganization());
    assert.equal(result.gpsLat, 20.1);
    assert.equal(result.gpsLng, 78.2);
  });

  // Regression test -- see the equivalent toPublicPartner test above.
  test("public, non-restricted: still exposes the country field", () => {
    const result = toPublicPartner(baseOrganization());
    assert.equal(result.country, "India");
  });

  // Regression coverage for the photo-history feature -- see the
  // equivalent toPublicPartner tests above.
  test("public, non-restricted: exposes only the current photo, not history", () => {
    const result = toPublicPartner(baseOrganization());
    assert.equal(result.photo, "/api/photos/p2/raw");
  });

  test("restricted: never exposes its real photo, current or otherwise — gets a generic silhouette instead", () => {
    const result = toPublicPartner(baseOrganization({ isRestricted: true }));
    assert.notEqual(result.photo, "/api/photos/p2/raw");
    assert.equal(isSilhouetteDataUri(result.photo), true);
  });
});
