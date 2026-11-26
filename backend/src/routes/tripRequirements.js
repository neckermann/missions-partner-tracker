// TripRequirement CRUD and its per-participant completion status (task-kind only).
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requireTripScope } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { sendRequirementNotificationEmail, emailParticipantSelect } = require("../utils/tripEmails");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("trips"));

async function tripIdOfRequirement(req) {
  const row = await prisma.tripRequirement.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}

const requirementSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["document", "task", "esignature"]).optional(),
  // Only meaningful for kind "esignature": the agreement text a participant signs. Not validated
  // against kind, since a requirement can be switched between kinds while editing.
  bodyText: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  // Only meaningful alongside dueAt; validated together below, not a DB constraint.
  reminderLeadDays: z.coerce.number().int().positive().optional().nullable(),
  // #278: scopes the requirement to the trip's minors (see schema.prisma for where it is checked).
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
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = requirementSchema
        .refine(reminderNeedsDueDate, REMINDER_NEEDS_DUE_DATE_ISSUE)
        .parse(req.body);
      const created = await prisma.tripRequirement.create({ data: { tripId: req.params.id, ...data } });

      // Document and esignature requirements are self-serve for a participant (public upload, "Sign
      // now"), so tell them when one is added. "task" is excluded: an admin checks it off, so a notice
      // would be noise.
      let emailResult;
      if (created.kind === "document" || created.kind === "esignature") {
        const trip = await prisma.trip.findUnique({
          where: { id: req.params.id },
          include: { participants: { select: emailParticipantSelect } },
        });
        emailResult = await sendRequirementNotificationEmail(trip, created, trip?.participants || []);
      }

      res.status(201).json({ ...created, manualEmail: emailResult?.manual });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/requirements/:id",
  requireRole("admin", "editor", "guest"),
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
  requireRole("admin", "editor", "guest"),
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

// PUT /api/trips/requirements/:id/participants/:participantId/complete -- task-kind only (a document
// is fulfilled via the anti-join against TripDocument). Upsert: most participant/requirement pairs
// have no TripRequirementStatus row until first needed.
router.put(
  "/requirements/:id/participants/:participantId/complete",
  requireRole("admin", "editor", "guest"),
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
      // #327 Finding 3: requireTripScope only checks the CALLER's trip against the requirement's trip, not
      // :participantId; without this check a Trip Leader scoped to Trip A could mark a participant on
      // Trip B complete against Trip A's requirement. Loaded unconditionally since every path needs it.
      const participant = await prisma.tripParticipant.findUnique({
        where: { id: req.params.participantId },
        select: { tripId: true, dateOfBirth: true },
      });
      if (!participant || participant.tripId !== requirement.tripId) {
        return res.status(404).json({ error: "Not found" });
      }
      // #278: a minors-only requirement never applies to a non-minor: nothing for an admin to complete.
      if (requirement.minorsOnly && !isMinorForTrip(participant.dateOfBirth, requirement.trip.startDate)) {
        return res.status(400).json({
          error: "This requirement only applies to minor participants",
        });
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
