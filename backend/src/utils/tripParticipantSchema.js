// Cross-field invariants need one enforcement point. participantSchema and
// defaultParticipantGoal serve two creation paths (a participant embedded in a
// trip's POST/PUT body in routes/trips.js, and the direct-add route in
// routes/tripParticipants.js), so they live here once.
const { z } = require("zod");
const { phoneSchema, emailSchema } = require("./contactFormat");

const participantSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.string().optional().nullable(),
  phone: phoneSchema(z),
  email: emailSchema(z),
  // Optional override; participant-creation routes default it to the trip's supportRaisingGoal (see defaultParticipantGoal).
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Optional/nullable: this schema backs admin-direct creation (historical
  // backfill), not the public application, where dateOfBirth is required.
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianFirstName: z.string().optional().nullable(),
  parentGuardianLastName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: phoneSchema(z),
  parentGuardianEmail: emailSchema(z),
});

// A participant's own supportRaisingGoal is independently editable, but starts at
// the trip's goal since almost every trip wants that. Applied once at creation,
// not a live fallback: changing the trip's goal never rewrites existing participants.
function defaultParticipantGoal(participant, tripGoal) {
  return participant.supportRaisingGoal !== undefined ? participant.supportRaisingGoal : (tripGoal ?? null);
}

// A participant is a minor for a trip if they haven't turned 18 by the trip's
// startDate (not today: applicability is fixed at the trip). Shared by
// tripRequirements.js, publicTrips.js and tripReminderScheduler.js so a
// minors-only requirement never reminds an adult.
//
// Missing dateOfBirth or tripStartDate means "not a minor" (admin-direct/historical
// participants may have none), so a minors-only requirement is never wrongly hidden.
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
