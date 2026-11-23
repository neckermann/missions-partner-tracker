// #271 Finding 1: split out of trips.js -- see tripMeetings.js's own
// header comment for the full reasoning. Covers TripRequirement CRUD
// and its per-participant completion status (task-kind only).
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requireTripScope } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { sendRequirementNotificationEmail, emailParticipantSelect } = require("../utils/tripEmails");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
router.use(requireFeature("trips"));

async function tripIdOfRequirement(req) {
  const row = await prisma.tripRequirement.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}

// ---- Requirements (document or task, #252 generalization) ----

const requirementSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["document", "task", "esignature"]).optional(),
  // Only meaningful for kind: "esignature" -- the real agreement text a
  // participant signs. Not validated against kind here (a requirement
  // can be switched between kinds while editing; the frontend only shows
  // this field for esignature, but the backend doesn't need to enforce
  // it's empty for the other two).
  bodyText: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  // Only meaningful alongside dueAt -- validated together below, not
  // enforced as a DB constraint (same style as this file's other
  // cross-field zod .refine()s).
  reminderLeadDays: z.coerce.number().int().positive().optional().nullable(),
  // #278 -- scopes this requirement to only the trip's minor
  // participants. See schema.prisma's own comment on this column for
  // where it's checked.
  minorsOnly: z.boolean().optional(),
});
function reminderNeedsDueDate(data) {
  return !data.reminderLeadDays || !!data.dueAt;
}
const REMINDER_NEEDS_DUE_DATE_ISSUE = {
  message: "Set a due date before adding a reminder lead time",
  path: ["reminderLeadDays"],
};

router.post(
  "/:id/requirements",
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = requirementSchema
        .refine(reminderNeedsDueDate, REMINDER_NEEDS_DUE_DATE_ISSUE)
        .parse(req.body);
      const created = await prisma.tripRequirement.create({ data: { tripId: req.params.id, ...data } });

      // document- and esignature-kind requirements are the two kinds a
      // participant can self-serve (the public upload route and the
      // existing "Sign now" flow) -- tell them it exists the same moment an
      // admin adds it, rather than leaving them to discover it only by
      // revisiting their own trip page on their own. "task" stays excluded:
      // there's nothing for a participant to do from this email for one --
      // an admin checks it off, so a notice would just be noise.
      if (created.kind === "document" || created.kind === "esignature") {
        const trip = await prisma.trip.findUnique({
          where: { id: req.params.id },
          include: { participants: { select: emailParticipantSelect } },
        });
        await sendRequirementNotificationEmail(trip, created, trip?.participants || []);
      }

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/requirements/:id",
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope(tripIdOfRequirement),
  async (req, res, next) => {
    try {
      const data = requirementSchema
        .partial()
        .refine(reminderNeedsDueDate, REMINDER_NEEDS_DUE_DATE_ISSUE)
        .parse(req.body);
      const updated = await prisma.tripRequirement.update({ where: { id: req.params.id }, data });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/requirements/:id",
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope(tripIdOfRequirement),
  async (req, res, next) => {
    try {
      await prisma.tripRequirement.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/trips/requirements/:id/participants/:participantId/complete --
// task-kind only (a document's fulfillment is always the existing
// anti-join against TripDocument, never this). Upsert, not a plain
// update, since most participant/requirement pairs have no
// TripRequirementStatus row until the first time either this or the
// reminder scheduler needs one.
router.put(
  "/requirements/:id/participants/:participantId/complete",
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope(tripIdOfRequirement),
  async (req, res, next) => {
    try {
      const { completed } = z.object({ completed: z.boolean() }).parse(req.body);
      const requirement = await prisma.tripRequirement.findUnique({
        where: { id: req.params.id },
        include: { trip: { select: { startDate: true } } },
      });
      if (!requirement) return res.status(404).json({ error: "Not found" });
      if (requirement.kind !== "task") {
        return res.status(400).json({
          error:
            "Only a task requirement can be marked complete directly -- a document or e-signature requirement is fulfilled by its own document, not this",
        });
      }
      // #278 -- a minors-only requirement never applies to a non-minor
      // participant at all, so there's nothing for an admin to complete
      // on their behalf either.
      if (requirement.minorsOnly) {
        const participant = await prisma.tripParticipant.findUnique({
          where: { id: req.params.participantId },
          select: { dateOfBirth: true },
        });
        if (!participant) return res.status(404).json({ error: "Not found" });
        if (!isMinorForTrip(participant.dateOfBirth, requirement.trip.startDate)) {
          return res.status(400).json({
            error: "This requirement only applies to minor participants",
          });
        }
      }
      const status = await prisma.tripRequirementStatus.upsert({
        where: {
          requirementId_participantId: {
            requirementId: req.params.id,
            participantId: req.params.participantId,
          },
        },
        create: {
          requirementId: req.params.id,
          participantId: req.params.participantId,
          completedAt: completed ? new Date() : null,
        },
        update: { completedAt: completed ? new Date() : null },
      });
      res.json(status);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
