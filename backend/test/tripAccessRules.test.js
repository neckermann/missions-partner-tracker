// The pure grant rules: derived expiry = trip end date + 30 days (through the end of that
// day), an explicit override wins in both directions, and a guest's inactive reason. No
// database needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TRIP_ACCESS_GRACE_DAYS,
  effectiveExpiry,
  isGrantActive,
  parseOverrideExpiry,
  summarizeGrants,
  guestInactiveReason,
} = require("../src/utils/tripAccessRules");

const utc = (s) => new Date(`${s}T00:00:00.000Z`);

test("the grace period is fixed at 30 days", () => {
  assert.equal(TRIP_ACCESS_GRACE_DAYS, 30);
});

test("derived expiry is the end of the day 30 days after the trip's end date", () => {
  const exp = effectiveExpiry({ expiresAt: null }, { endDate: utc("2026-06-01") });
  assert.equal(exp.toISOString(), "2026-07-01T23:59:59.999Z");
});

test("a trip with no end date has no derived expiry", () => {
  assert.equal(effectiveExpiry({ expiresAt: null }, { endDate: null }), null);
  assert.equal(effectiveExpiry({ expiresAt: null }, null), null);
});

test("an override wins over the derived date, earlier or later", () => {
  const trip = { endDate: utc("2026-06-01") };
  const earlier = new Date("2026-06-02T00:00:00.000Z");
  const later = new Date("2027-01-01T00:00:00.000Z");
  assert.equal(effectiveExpiry({ expiresAt: earlier }, trip), earlier);
  assert.equal(effectiveExpiry({ expiresAt: later }, trip), later);
  // ...and it supplies an expiry where none would be derived
  assert.equal(effectiveExpiry({ expiresAt: later }, { endDate: null }), later);
});

test("a grant is active through its last instant and not after", () => {
  const trip = { endDate: utc("2026-06-01") };
  assert.equal(isGrantActive({ expiresAt: null }, trip, new Date("2026-07-01T23:59:59.999Z")), true);
  assert.equal(isGrantActive({ expiresAt: null }, trip, new Date("2026-07-02T00:00:00.000Z")), false);
  assert.equal(isGrantActive({ expiresAt: null }, { endDate: null }, new Date("2999-01-01")), true);
});

test("an admin-entered date means through the end of that day; a timestamp is taken as given", () => {
  assert.equal(parseOverrideExpiry("2027-03-01").toISOString(), "2027-03-01T23:59:59.999Z");
  assert.equal(parseOverrideExpiry("2027-03-01T10:00:00.000Z").toISOString(), "2027-03-01T10:00:00.000Z");
  assert.equal(parseOverrideExpiry(null), null);
  assert.ok(Number.isNaN(parseOverrideExpiry("nonsense").getTime()));
});

test("summarizeGrants marks overrides, effective expiry and active", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const [past, override, open] = summarizeGrants(
    [
      { id: "a", tripId: "t1", expiresAt: null, createdAt: now, trip: { endDate: utc("2026-06-01") } },
      {
        id: "b",
        tripId: "t2",
        expiresAt: new Date("2026-12-31T00:00:00Z"),
        createdAt: now,
        trip: { endDate: utc("2026-06-01") },
      },
      { id: "c", tripId: "t3", expiresAt: null, createdAt: now, trip: { endDate: null } },
    ],
    now
  );
  assert.deepEqual([past.active, override.active, open.active], [false, true, true]);
  assert.deepEqual(
    [past.expiresIsOverride, override.expiresIsOverride, open.expiresIsOverride],
    [false, true, false]
  );
  assert.equal(open.effectiveExpiresAt, null);
});

test("guestInactiveReason: deactivated, no_access, expired, or null when they can sign in", () => {
  const live = { active: true, expiresAt: null };
  assert.equal(guestInactiveReason({ role: "guest", active: false }, [{ active: true }]), "deactivated");
  assert.equal(guestInactiveReason({ role: "guest", active: true }, []), "no_access");
  assert.equal(guestInactiveReason({ role: "guest", active: true }, [{ active: false }]), "expired");
  assert.equal(guestInactiveReason({ role: "guest", active: true }, [{ active: false }, live]), null);
  assert.equal(
    guestInactiveReason({ role: "editor", active: false }, []),
    null,
    "never reported for a full role"
  );
});
