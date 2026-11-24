// Everything about what a guest login (role: "guest") may reach, in one
// place (#356). Reach comes only from grant rows -- TripAccess today, and
// #289 adds care team seats to the same helpers -- never from the role
// itself, so routes ask this file instead of re-deriving it.
//
// Effective access = max(role baseline, grants). The guest baseline is
// nothing, so a guest with no active grant can do nothing at all and
// requireAuth refuses the session.

const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
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

// Whether care teams are on. Read from ChurchSettings like every other
// feature gate; only guests ever need it here (a full role's reach doesn't
// depend on it), so requireAuth asks for it for guests only.
async function isCareTeamEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "careTeam");
}

// What requireAuth attaches for a guest: the trips and partners their
// currently-active grants reach. A grant is a TripAccess row that hasn't
// lapsed, or -- when care teams are on -- a care team seat, which reaches
// that one partner and never expires (#289).
async function resolveGuestReach(userId, now = new Date()) {
  const grants = (await listTripGrants(userId, now)).filter((g) => g.active);
  const tripIds = grants.map((g) => g.tripId);
  const partnerIds = new Set(grants.map((g) => g.trip.partnerId).filter(Boolean));
  let seatCount = 0;
  // Trips a guest may READ: the ones they hold a grant for (which they may
  // also write), plus -- through a care team seat -- every trip of that
  // partner (#289: "view access to their partner's trips"), read-only.
  const readTripIds = new Set(tripIds);
  // Partners reached through a care team seat specifically -- a wider view
  // than a trip grant gives (one-time needs, the list pages, #289).
  const careTeamPartnerIds = new Set();
  if (await isCareTeamEnabled()) {
    const seats = await prisma.careTeamMember.findMany({ where: { userId }, select: { partnerId: true } });
    seatCount = seats.length;
    seats.forEach((s) => partnerIds.add(s.partnerId));
    seats.forEach((s) => careTeamPartnerIds.add(s.partnerId));
    if (seats.length > 0) {
      const partnerTrips = await prisma.trip.findMany({
        where: { partnerId: { in: seats.map((s) => s.partnerId) } },
        select: { id: true },
      });
      partnerTrips.forEach((t) => readTripIds.add(t.id));
    }
  }
  return {
    tripIds: [...readTripIds], // readable
    grantedTripIds: tripIds, // writable: only what an admin granted
    partnerIds: [...partnerIds],
    careTeamPartnerIds: [...careTeamPartnerIds],
    hasActiveGrant: grants.length > 0 || seatCount > 0,
  };
}

// Whether this login holds a care team seat on the partner, with care teams
// on. Being on a partner's care team is what lets a non-staff login (a
// viewer or a guest) submit and edit that partner's prayer requests and one-
// time needs -- never decide a need, delete, or make anything public or
// urgent -- and everything they enter is held for staff review (see
// DispatchRecord.reviewRequired). Admin/editor don't need a seat.
async function isOnCareTeamFor(user, partnerId) {
  if (!user?.id || !partnerId) return false;
  if (!(await isCareTeamEnabled())) return false;
  const seat = await prisma.careTeamMember.findUnique({
    where: { partnerId_userId: { partnerId, userId: user.id } },
    select: { id: true },
  });
  return !!seat;
}

// Deactivates a guest (never deletes) who has no trip grant row and no care
// team seat left, and ends their open sessions. Used when the last grant of
// either kind is removed. Counts seats regardless of the careTeam flag: the
// data is preserved when the flag is off, so turning it back on shouldn't
// find the account already deactivated. `db` may be a transaction handle.
// Returns true when it deactivated.
async function deactivateGuestIfNoGrants(db, user) {
  if (user.role !== "guest" || !user.active) return false;
  const [trips, seats] = await Promise.all([
    db.tripAccess.count({ where: { userId: user.id } }),
    db.careTeamMember.count({ where: { userId: user.id } }),
  ]);
  if (trips + seats > 0) return false;
  await db.user.update({ where: { id: user.id }, data: { active: false, sessionVersion: { increment: 1 } } });
  return true;
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

// One-time needs are a care team view: a guest reads them only for partners
// whose team they're on. A trip leader's smaller scope (a trip grant) never
// includes them. null = no restriction (every non-guest role).
function readableNeedPartnerIds(user) {
  if (user.role !== "guest") return null;
  return user.careTeamPartnerIds || [];
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

// Writing is narrower than reading for a guest: only trips an admin granted
// them (TripAccess), never a trip they can merely see through a care team
// seat on its partner (#289).
function canWriteTrip(user, tripId) {
  if (user.role !== "guest") return true;
  return !!tripId && (user.grantedTripIds || []).includes(tripId);
}

module.exports = {
  TRIP_ACCESS_GRACE_DAYS,
  effectiveExpiry,
  isGrantActive,
  parseOverrideExpiry,
  listTripGrants,
  resolveGuestReach,
  isCareTeamEnabled,
  isOnCareTeamFor,
  deactivateGuestIfNoGrants,
  readablePartnerIds,
  readableNeedPartnerIds,
  canReadPartner,
  readableTripIds,
  canReadTrip,
  canWriteTrip,
  GRANT_SELECT,
  summarizeGrants,
  guestInactiveReason,
};
