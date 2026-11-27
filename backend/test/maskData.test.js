const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  toInitials,
  toPublicPartner,
  missionaryHouseholdCategory,
  maskedDisplayName,
  initialsOfAdults,
  restrictedInitials,
} = require("../src/utils/maskData");

// Missionary and organization are one Partner model with a `kind` discriminator, so both
// fixtures feed the same serializer. The describe blocks stay split by kind because the
// masking rules differ (initials vs. name, silhouette vs. building icon, missionary-only
// fields).

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

// Shared by the public API, dispatch blurbs (GroupMe/WhatsApp/email), email digest tiles, trip
// pages and shared report exports, so it is unit-tested directly rather than only through each
// caller.
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

  // Regression test: this field was only set on the isRestricted branch, so every non-restricted
  // record came back with country === undefined, silently breaking the public directory's
  // continent/country filters and search.
  test("public, non-restricted: still exposes the country field", () => {
    const result = toPublicPartner(baseMissionary());
    assert.equal(result.country, "Thailand");
  });

  // fipsCountryCode is for Joshua Project lookups only, deliberately not a fallback for this
  // field: a record with no address country shows as uncategorized in the public filters rather
  // than inheriting a stale FIPS code.
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
    assert.equal(result.photo, "/api/photos/p2");
    assert.equal(result.photoFull, "/api/photos/p2/raw");
  });

  test("public, non-restricted: photo is null when no photos exist", () => {
    const result = toPublicPartner(baseMissionary({ photos: [] }));
    assert.equal(result.photo, null);
  });

  test("restricted: never exposes their real photo, current or otherwise — gets a generic silhouette instead", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true, photos: [{ id: "p1" }] }));
    assert.notEqual(result.photo, "/api/photos/p1");
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

  // A restricted missionary's silhouette must not vary with real household composition (that is
  // itself identifying): every restricted missionary gets the same plain single-person shape.
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

  // supportingSince is masked for a restricted record: unmasked, combined with country and the
  // masked name, it narrows down a small country's expat community further than needed.
  test("restricted: never exposes supportingSince", () => {
    const result = toPublicPartner(baseMissionary({ isRestricted: true, supportingSince: "2014-01-01" }));
    assert.equal(result.supportingSince, null);
  });

  test("public, non-restricted: still exposes supportingSince", () => {
    const result = toPublicPartner(baseMissionary({ supportingSince: "2014-01-01" }));
    assert.equal(result.supportingSince, "2014-01-01");
  });

  // restrictedPartnerInitialsEnabled defaults true (opt-out), so omitting settings entirely (as
  // every test above does) must still produce initials, not fall back to a generic label.
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

  // A named Christian organization in a hostile country is a fixed, physically locatable target,
  // so it gets the same name masking a restricted missionary does (see the note on
  // toPublicPartner).
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
    assert.equal(result.photo, "/api/photos/p2");
  });

  test("restricted: never exposes its real photo, current or otherwise — gets a generic silhouette instead", () => {
    const result = toPublicPartner(baseOrganization({ isRestricted: true }));
    assert.notEqual(result.photo, "/api/photos/p2");
    assert.equal(isSilhouetteDataUri(result.photo), true);
  });
});

// A restricted missionary household is shown by its adults' initials, not by initials of the display name (which turned
// "Tim and Sarah Smith" into "T.A.S.S.").
describe("restricted initials from the adults (#544)", () => {
  const adult = (firstName, lastName, extra = {}) => ({ firstName, lastName, ...extra });

  test("a single adult is 'T.S.'", () => {
    assert.equal(initialsOfAdults([adult("Tim", "Smith")]), "T.S.");
  });

  test("a couple is 'T.S. and S.S.', whether or not they share a surname", () => {
    assert.equal(initialsOfAdults([adult("Tim", "Smith"), adult("Sarah", "Smith")]), "T.S. and S.S.");
    assert.equal(initialsOfAdults([adult("Tim", "Smith"), adult("Sarah", "Jones")]), "T.S. and S.J.");
  });

  test("three adults are listed 'T.S., S.S. and J.K.'", () => {
    assert.equal(
      initialsOfAdults([adult("Tim", "Smith"), adult("Sarah", "Smith"), adult("Joy", "Kim")]),
      "T.S., S.S. and J.K."
    );
  });

  test("an adult with only a first name gives 'T.', and one with no name is left out", () => {
    assert.equal(initialsOfAdults([adult("Tim", null)]), "T.");
    assert.equal(initialsOfAdults([adult("Tim", "Smith"), adult(null, null), adult("", "  ")]), "T.S.");
    assert.equal(initialsOfAdults([adult(null, null)]), "");
  });

  test("the primary contact is first, then the order they were added, whatever order they are loaded in", () => {
    const sarah = adult("Sarah", "Smith", { isPrimaryContact: true, createdAt: "2026-02-01" });
    const tim = adult("Tim", "Smith", { createdAt: "2026-01-01" });
    const joy = adult("Joy", "Kim", { createdAt: "2026-03-01" });
    assert.equal(initialsOfAdults([joy, tim, sarah]), "S.S., T.S. and J.K.");
    const noPrimary = [
      adult("Joy", "Kim", { createdAt: "2026-03-01" }),
      adult("Tim", "Smith", { createdAt: "2026-01-01" }),
    ];
    assert.equal(initialsOfAdults(noPrimary), "T.S. and J.K.");
  });

  test("letters are upper-cased and an accented or non-Latin first letter still works", () => {
    assert.equal(initialsOfAdults([adult("élise", "dupont")]), "É.D.");
    assert.equal(initialsOfAdults([adult("  jun", "li")]), "J.L.");
  });

  test("no adults loaded, or none recorded, falls back to the display name's initials", () => {
    assert.equal(restrictedInitials({ displayName: "Tim and Sarah Smith" }), "T.A.S.S.");
    assert.equal(restrictedInitials({ displayName: "Tim Smith", adults: [] }), "T.S.");
  });

  test("an organization always uses its display name, even if adults are somehow on it", () => {
    assert.equal(
      restrictedInitials({
        kind: "organization",
        displayName: "Bright Hope Ministries",
        adults: [adult("A", "B")],
      }),
      "B.H.M."
    );
  });

  test("maskedDisplayName uses the adults when restricted, never the real names, and ignores them when not restricted", () => {
    const partner = {
      isRestricted: true,
      displayName: "Tim and Sarah Smith",
      fieldDisplayName: "Northern Kenya",
      adults: [adult("Tim", "Smith"), adult("Sarah", "Smith")],
    };
    const shown = maskedDisplayName(partner);
    assert.equal(shown, "T.S. and S.S.");
    assert.ok(!/Tim|Sarah|Smith/.test(shown));
    assert.equal(maskedDisplayName({ ...partner, isRestricted: false }), "Tim and Sarah Smith");
  });

  test("with initials switched off the field name (or the generic label) is used, adults never", () => {
    const partner = {
      isRestricted: true,
      displayName: "Tim Smith",
      fieldDisplayName: "Northern Kenya",
      adults: [adult("Tim", "Smith")],
    };
    assert.equal(maskedDisplayName(partner, { restrictedPartnerInitialsEnabled: false }), "Northern Kenya");
    assert.equal(
      maskedDisplayName({ ...partner, fieldDisplayName: null }, { restrictedPartnerInitialsEnabled: false }),
      "A restricted-access partner"
    );
  });

  test("a restricted partner's public record carries the adults' initials, and no adult name anywhere in it", () => {
    const record = {
      id: "p1",
      kind: "missionary",
      isPublic: true,
      isRestricted: true,
      archived: false,
      displayName: "Tim and Sarah Smith",
      adults: [adult("Tim", "Smith"), adult("Sarah", "Smith")],
      children: [],
      addresses: [],
      photos: [],
      links: [],
      languages: [],
      sendingParties: [],
    };
    const result = toPublicPartner(record);
    assert.equal(result.displayName, "T.S. and S.S.");
    assert.ok(!/Tim|Sarah|Smith/.test(JSON.stringify(result)), "no real name in the public record");
  });
});
