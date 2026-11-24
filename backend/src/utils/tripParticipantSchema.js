// #271 Design Principle 3: a cross-field invariant that matters needs one
// enforcement point, not a client-side convention repeated at every call
// site. participantSchema/defaultParticipantGoal are needed identically
// by two creation paths -- a participant embedded directly in a trip's
// own POST/PUT body (routes/trips.js) and the direct-add route
// (routes/tripParticipants.js) -- so they live here, once, rather than
// as two copies that could quietly drift out of sync.
const { z } = require("zod");

const participantSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // Optional override -- almost always left unset, in which case every
  // participant-creation route defaults it to the trip's own
  // supportRaisingGoal at that moment (see defaultParticipantGoal).
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Optional/nullable here specifically -- this schema backs admin-direct
  // participant creation (a historical backfill, or an admin adding
  // someone outside the public application flow), not the public
  // application itself, where dateOfBirth is always required (see
  // publicTripApplications.js). An admin entering a historical record has
  // no reason to be blocked on it.
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianFirstName: z.string().optional().nullable(),
  parentGuardianLastName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: z.string().optional().nullable(),
  parentGuardianEmail: z.string().optional().nullable(),
});

// A participant's own supportRaisingGoal is a plain, independently
// editable number (AdminTripParticipantDetail.jsx) -- but starting every
// new participant at null, even though almost every trip wants each
// person aiming for roughly the trip's own total, was pure friction.
// Applied once at creation time, not as a live display fallback --
// changing the trip's goal afterward never retroactively rewrites an
// already-created participant's own number.
function defaultParticipantGoal(participant, tripGoal) {
  return participant.supportRaisingGoal !== undefined ? participant.supportRaisingGoal : (tripGoal ?? null);
}

// #278: a participant is a minor for a given trip if they haven't turned
// 18 by that trip's own startDate -- not today's date, since a
// requirement's applicability is fixed at the trip the requirement
// belongs to, not whenever someone happens to check. Shared by
// tripRequirements.js (minorsOnly filtering), publicTrips.js (the
// self-service requirements list), and tripReminderScheduler.js (so a
// minors-only requirement never reminds an adult), rather than
// reimplemented per call site.
//
// Missing dateOfBirth or tripStartDate defaults to "not a minor" -- the
// public application always collects and requires it now, but an
// admin-direct/historical participant (participantSchema above) may still
// have none on file; treating an unknown age as adult is the least
// disruptive default (it never wrongly hides a minors-only requirement
// from someone who might actually need it).
function isMinorForTrip(dateOfBirth, tripStartDate) {
  if (!dateOfBirth || !tripStartDate) return false;
  const dob = new Date(dateOfBirth);
  const start = new Date(tripStartDate);
  let age = start.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayByStart =
    start.getUTCMonth() > dob.getUTCMonth() ||
    (start.getUTCMonth() === dob.getUTCMonth() && start.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayByStart) age--;
  return age < 18;
}

module.exports = { participantSchema, defaultParticipantGoal, isMinorForTrip };
