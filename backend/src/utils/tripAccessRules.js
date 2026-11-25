// The pure rules for trip-access grants: when a grant lapses, how it looks to the
// UI, why a guest might be inactive. No I/O or Prisma import, so the database-free
// reporting registry and unit tests can use it; utils/guestAccess.js adds queries.

// Trip access lapses this long after the trip's end date unless an admin overrides it on the grant. Fixed, not a setting.
const TRIP_ACCESS_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// The last instant a grant is valid, or null for "never lapses". An explicit
// override on the grant wins in both directions (extend, or end now). Derived
// from Trip.endDate at check time, so changing the trip's dates moves every
// grant's expiry. endDate is date-only (UTC midnight), so this is the end of
// that day plus the grace period.
function effectiveExpiry(grant, trip) {
  if (grant.expiresAt) return grant.expiresAt;
  if (trip?.endDate) {
    return new Date(trip.endDate.getTime() + (TRIP_ACCESS_GRACE_DAYS + 1) * DAY_MS - 1);
  }
  return null;
}

function isGrantActive(grant, trip, now = new Date()) {
  const expiry = effectiveExpiry(grant, trip);
  return !expiry || expiry >= now;
}

// A date-only admin value ("extend access to 2027-03-01") means through the end of that day; a full timestamp is taken as given.
function parseOverrideExpiry(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`);
  return new Date(s);
}

// Shapes TripAccess rows (selected with their trip's endDate) for the admin UI and
// /me: the stored override, effective expiry, and whether it is active now. Includes expired grants.
const GRANT_SELECT = {
  id: true,
  tripId: true,
  expiresAt: true,
  createdAt: true,
  trip: {
    select: {
      id: true,
      name: true,
      type: true,
      endDate: true,
      partnerId: true,
      partner: { select: { displayName: true } },
    },
  },
};

function summarizeGrants(rows, now = new Date()) {
  return rows.map((r) => {
    const effective = effectiveExpiry(r, r.trip);
    return {
      id: r.id,
      tripId: r.tripId,
      trip: r.trip,
      expiresAt: r.expiresAt, // the override only, null when derived
      effectiveExpiresAt: effective,
      expiresIsOverride: !!r.expiresAt,
      active: !effective || effective >= now,
      createdAt: r.createdAt,
    };
  });
}

// Why a guest can currently do nothing, or null. Computed, not stored, so it
// can't go stale as trip dates move; feeds the Users list's "Inactive accounts"
// filter. `seatCount` is the care team seats that count (the caller passes 0 when
// careTeam is off); a seat never expires, so it keeps a guest signed-in-able
// even when every trip has lapsed.
function guestInactiveReason(user, grants, seatCount = 0) {
  if (user.role !== "guest") return null;
  if (!user.active) return "deactivated";
  if (seatCount > 0) return null;
  if (grants.length === 0) return "no_access";
  if (!grants.some((g) => g.active)) return "expired";
  return null;
}

module.exports = {
  TRIP_ACCESS_GRACE_DAYS,
  effectiveExpiry,
  isGrantActive,
  parseOverrideExpiry,
  GRANT_SELECT,
  summarizeGrants,
  guestInactiveReason,
};
