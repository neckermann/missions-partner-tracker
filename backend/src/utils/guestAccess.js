// Everything about what a guest login (role: "guest") may reach, in one
// place (#356). Reach comes only from grant rows -- TripAccess today, and
// #289 adds care team seats to the same helpers -- never from the role
// itself, so routes ask this file instead of re-deriving it.
//
// Effective access = max(role baseline, grants). The guest baseline is
// nothing, so a guest with no active grant can do nothing at all and
// requireAuth refuses the session.

const prisma = require("../prismaClient");
const {
  TRIP_ACCESS_GRACE_DAYS,
  effectiveExpiry,
  isGrantActive,
  parseOverrideExpiry,
  GRANT_SELECT,
  summarizeGrants,
  guestInactiveReason,
} = require("./tripAccessRules");

async function listTripGrants(userId, now = new Date()) {
  const rows = await prisma.tripAccess.findMany({
    where: { userId },
    select: GRANT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return summarizeGrants(rows, now);
}

// What requireAuth attaches for a guest: the trips and partners their
// currently-active grants reach.
async function resolveGuestReach(userId, now = new Date()) {
  const grants = (await listTripGrants(userId, now)).filter((g) => g.active);
  const tripIds = grants.map((g) => g.tripId);
  const partnerIds = [...new Set(grants.map((g) => g.trip.partnerId).filter(Boolean))];
  return { tripIds, partnerIds, hasActiveGrant: grants.length > 0 };
}

// The one place that answers "which partners may this login read?".
// null means no restriction (admin/editor/viewer); an array is the
// complete allowed set for a guest. Single-record routes (partner detail,
// file download) and partner-keyed list routes must all go through this
// rather than re-deriving it from a trip.
function readablePartnerIds(user) {
  if (user.role !== "guest") return null;
  return user.partnerIds || [];
}

function canReadPartner(user, partnerId) {
  const ids = readablePartnerIds(user);
  return ids === null || ids.includes(partnerId);
}

// Same idea for trips.
function readableTripIds(user) {
  if (user.role !== "guest") return null;
  return user.tripIds || [];
}

function canReadTrip(user, tripId) {
  const ids = readableTripIds(user);
  return ids === null || (!!tripId && ids.includes(tripId));
}

module.exports = {
  TRIP_ACCESS_GRACE_DAYS,
  effectiveExpiry,
  isGrantActive,
  parseOverrideExpiry,
  listTripGrants,
  resolveGuestReach,
  readablePartnerIds,
  canReadPartner,
  readableTripIds,
  canReadTrip,
  GRANT_SELECT,
  summarizeGrants,
  guestInactiveReason,
};
