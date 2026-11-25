// What a care team seat sees of a partner's trip (#409): names and dates, nothing more. A guest who
// can read a trip only because they sit on its partner's care team (no TripAccess grant, so
// `canWriteTrip` is false) gets the trip's name, type, status, dates and who is on the team, but
// never contact details, dates of birth, applications, documents, money, flights, requirements,
// meetings or the private apply-link tokens. A trip leader with a grant, and every full role, is
// unaffected.
const { canWriteTrip } = require("./guestAccess");

const isSeatOnly = (user, tripId) => user.role === "guest" && !canWriteTrip(user, tripId);

const TRIP_FIELDS = [
  "id",
  "partnerId",
  "partner",
  "name",
  "type",
  "status",
  "startDate",
  "endDate",
  "description",
  "teamSizeMin",
  "teamSizeMax",
  "createdAt",
  "lastEditedAt",
  "lastEditedByName",
];

// Keeps the response's shape (every list the page reads is still present, just empty) so the page
// renders without special cases.
function redactTripForSeat(trip) {
  const out = {};
  for (const key of TRIP_FIELDS) if (key in trip) out[key] = trip[key];
  for (const [key, value] of Object.entries(trip)) {
    if (Array.isArray(value) && !(key in out)) out[key] = [];
  }
  out.participants = (trip.participants || []).map((p) => ({
    id: p.id,
    tripId: p.tripId,
    firstName: p.firstName,
    lastName: p.lastName,
  }));
  if ("enableTripBudgeting" in trip) out.enableTripBudgeting = false;
  for (const flag of ["hasPendingApplications", "hasOverdueRequirement", "departingSoonIncomplete"]) {
    if (flag in trip) out[flag] = false;
  }
  return out;
}

module.exports = { isSeatOnly, redactTripForSeat };
