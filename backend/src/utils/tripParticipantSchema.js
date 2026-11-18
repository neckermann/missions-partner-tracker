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
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // Optional override -- almost always left unset, in which case every
  // participant-creation route defaults it to the trip's own
  // supportRaisingGoal at that moment (see defaultParticipantGoal).
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Only meaningful when the trip's own collectParentGuardianInfo is on
  // -- see Trip.collectParentGuardianInfo's own schema comment.
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianName: z.string().optional().nullable(),
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

module.exports = { participantSchema, defaultParticipantGoal };
