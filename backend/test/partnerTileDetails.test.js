// The digest email's photo-tile header (shared by admin and public-subscriber recipients) must
// not leak a restricted partner's real household shape (silhouette varies by
// single/couple/family) or supportingSinceYear.
const test = require("node:test");
const assert = require("node:assert/strict");
const { partnerTileDetails } = require("../src/utils/emailDispatchShell");

test("a non-restricted missionary with no photo still varies by real household shape", () => {
  const single = partnerTileDetails({ kind: "missionary", adults: [], children: [] });
  const couple = partnerTileDetails({
    kind: "missionary",
    adults: [{ id: "a1" }, { id: "a2" }],
    children: [],
  });
  // Not a security boundary -- just placeholder variety for a missing
  // photo -- so this is unaffected by the restricted-partner fix below.
  assert.notEqual(single.photoSrc, couple.photoSrc);
});

test("a restricted missionary always gets the plain single-person shape, regardless of real household", () => {
  const single = partnerTileDetails({ kind: "missionary", isRestricted: true, adults: [], children: [] });
  const family = partnerTileDetails({
    kind: "missionary",
    isRestricted: true,
    adults: [{ id: "a1" }],
    children: [{ id: "c1" }],
  });
  assert.equal(single.photoSrc, family.photoSrc);
});

test("a restricted partner never exposes supportingSinceYear", () => {
  const result = partnerTileDetails({
    kind: "missionary",
    isRestricted: true,
    supportingSince: "2014-03-01",
  });
  assert.equal(result.supportingSinceYear, null);
});

test("a non-restricted partner still exposes supportingSinceYear", () => {
  const result = partnerTileDetails({
    kind: "missionary",
    isRestricted: false,
    supportingSince: "2014-03-01",
  });
  assert.equal(result.supportingSinceYear, 2014);
});

test("returns null for a missing partner (e.g. deleted since the dispatch was recorded)", () => {
  assert.equal(partnerTileDetails(null), null);
  assert.equal(partnerTileDetails(undefined), null);
});

test("a partner who is not on the public site gets the silhouette, not a photo address a mail client cannot open", () => {
  const person = { kind: "missionary", adults: [], children: [], photos: [{ id: "p1" }] };
  process.env.APP_BASE_URL = "https://example.test";
  const hidden = partnerTileDetails({ ...person, isPublic: false });
  const open = partnerTileDetails({ ...person, isPublic: true });
  assert.doesNotMatch(hidden.photoSrc, /\/api\/photos\//);
  assert.match(open.photoSrc, /\/api\/photos\/p1\/raw/);
});
