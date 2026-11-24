// The pure rules for trip-access grants (#356): when a grant lapses, what a
// grant looks like to the UI, and why a guest might be inactive. No I/O and
// no Prisma import, so the reporting registry (which is deliberately
// database-free until a report's fetch runs) and unit tests can use it.
// utils/guestAccess.js adds the queries on top.

// Trip access lapses this long after the trip's end date, unless an admin
// overrides it on the grant. Fixed, not a ChurchSettings field (#356: terms
// and timings are plain defaults in v1; a setting can come later).
const TRIP_ACCESS_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// The last instant a grant is valid, or null for "never lapses". An
// explicit override on the grant wins over the derived date in both
// directions (extend, or end now). Derived from Trip.endDate at check
// time rather than stored, so changing the trip's dates moves every
// grant's expiry with it. endDate is a date-only column (UTC midnight),
// so the last valid instant is the end of that day + the grace period.
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

// A date-only value from an admin ("extend access to 2027-03-01") means
// through the end of that day; a full timestamp is taken as given.
function parseOverrideExpiry(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`);
  return new Date(s);
}

// Shapes TripAccess rows (selected with their trip's endDate) into what the
// admin UI and /me need: the stored override, the effective expiry, and
// whether the grant is active right now. Expired grants are included.
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

// Why a guest can currently do nothing, or null when they can. Computed,
// not stored, so it can't go stale as trip dates move. Feeds the Users
// list's "Inactive accounts" filter so an admin can reach out and clean up.
function guestInactiveReason(user, grants) {
  if (user.role !== "guest") return null;
  if (!user.active) return "deactivated";
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
