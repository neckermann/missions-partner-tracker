// Everything a guest login (role: "guest") may reach, in one place. Reach comes
// only from grant rows (TripAccess, care team seats), never the role, so routes
// ask this file. Effective access = max(role baseline, grants); the guest
// baseline is nothing, so with no active grant requireAuth refuses the session.

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

// Whether care teams are on (ChurchSettings feature gate); only guests need it, so requireAuth asks for guests only.
async function isCareTeamEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "careTeam");
}

// Whether trips are on. A guest's trip access is tied to this switch exactly as a care team seat is tied to care
// teams: while it is off the grant rows are kept, but they reach nothing (server-side, not only on screen).
async function isTripsEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "trips");
}

// What requireAuth attaches for a guest: the trips and partners their active
// grants reach. A grant is an unlapsed TripAccess row (while trips is on) or, with care teams on, a
// care team seat (reaches that one partner, never expires). `pausedFeatures` lists the switched-off
// features that a grant the guest holds depends on, so they can be told "your church has paused this"
// rather than bounced to sign-in; access returns unchanged when the switch is turned back on.
async function resolveGuestReach(userId, now = new Date()) {
  const tripsOn = await isTripsEnabled();
  const activeGrants = (await listTripGrants(userId, now)).filter((g) => g.active);
  const grants = tripsOn ? activeGrants : [];
  const pausedFeatures = [];
  if (!tripsOn && activeGrants.length > 0) pausedFeatures.push("trips");
  const tripIds = grants.map((g) => g.tripId);
  const partnerIds = new Set(grants.map((g) => g.trip.partnerId).filter(Boolean));
  let seatCount = 0;
  // Trips a guest may READ: those they hold a grant for (also writable), plus
  // every trip of a partner they have a care team seat on, read-only.
  const readTripIds = new Set(tripIds);
  // Partners reached through a care team seat: a wider view than a trip grant (one-time needs, list pages).
  const careTeamPartnerIds = new Set();
  const careOn = await isCareTeamEnabled();
  const seats = await prisma.careTeamMember.findMany({ where: { userId }, select: { partnerId: true } });
  if (!careOn && seats.length > 0) pausedFeatures.push("careTeam");
  if (careOn) {
    seatCount = seats.length;
    seats.forEach((s) => partnerIds.add(s.partnerId));
    seats.forEach((s) => careTeamPartnerIds.add(s.partnerId));
    if (seats.length > 0 && tripsOn) {
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
    pausedFeatures,
  };
}

// Whether this login holds a care team seat on the partner, with care teams on.
// A seat lets a non-staff login (viewer or guest) submit and edit that partner's
// prayer requests and one-time needs, never decide a need, delete, or make
// anything public or urgent; everything they enter is held for staff review (see
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

// Deactivates (never deletes) a guest with no trip grant row and no care team
// seat left, and ends their open sessions. Counts seats regardless of the
// careTeam flag, so turning it back on doesn't find the account already
// deactivated. `db` may be a transaction handle. Returns true when it deactivated.
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

// The one place that answers "which partners may this login read?". null = no
// restriction (admin/editor/viewer); an array is a guest's complete allowed set.
// Single-record and partner-keyed list routes must go through this.
function readablePartnerIds(user) {
  if (user.role !== "guest") return null;
  return user.partnerIds || [];
}

// One-time needs are a care team view: a guest reads them only for partners whose
// team they're on (a trip grant never includes them). null = no restriction.
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

// Writing is narrower than reading: only trips an admin granted (TripAccess),
// never one merely visible through a care team seat on its partner.
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
  isTripsEnabled,
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
