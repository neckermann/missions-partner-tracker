const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requireTripScope } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { sendMeetingEmail, emailParticipantSelect } = require("../utils/tripEmails");

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("trips"));

// requireTripScope needs the owning trip id; every route here but create is addressed by meeting id.
async function tripIdOfMeeting(req) {
  const row = await prisma.tripMeeting.findUnique({ where: { id: req.params.id }, select: { tripId: true } });
  return row?.tripId;
}

const meetingInputSchema = z.object({
  startAt: z.coerce.date().optional(),
  title: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  // An empty string (cleared form input) means "no link"; url() would reject it.
  meetingLink: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  agenda: z.string().optional().nullable(),
});

router.post(
  "/:id/meetings",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = meetingInputSchema.required({ startAt: true }).parse(req.body);
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id },
        include: { participants: { select: emailParticipantSelect } },
      });
      if (!trip) return res.status(404).json({ error: "Not found" });

      const meeting = await prisma.tripMeeting.create({ data: { ...data, tripId: trip.id } });
      const emailResult = await sendMeetingEmail(trip, meeting, "A meeting has been scheduled.");
      res.status(201).json({ ...meeting, manualEmail: emailResult?.manual });
    } catch (err) {
      next(err);
    }
  }
);

// Reschedule-resend: a change to startAt, location or meetingLink counts as a reschedule and
// triggers a resend; an agenda-only edit updates silently.
router.put(
  "/meetings/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfMeeting),
  async (req, res, next) => {
    try {
      const data = meetingInputSchema.parse(req.body);
      const existing = await prisma.tripMeeting.findUnique({
        where: { id: req.params.id },
        include: { trip: { include: { participants: { select: emailParticipantSelect } } } },
      });
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.cancelledAt) return res.status(400).json({ error: "This meeting has been cancelled." });

      const rescheduled =
        (data.startAt !== undefined &&
          new Date(data.startAt).getTime() !== new Date(existing.startAt).getTime()) ||
        (data.location !== undefined && data.location !== existing.location) ||
        (data.meetingLink !== undefined && data.meetingLink !== existing.meetingLink);

      const updated = await prisma.tripMeeting.update({ where: { id: req.params.id }, data });

      let emailResult;
      if (rescheduled) {
        emailResult = await sendMeetingEmail(existing.trip, updated, "Your trip meeting has been updated.");
      }
      res.json({ ...updated, manualEmail: emailResult?.manual });
    } catch (err) {
      next(err);
    }
  }
);

// Explicit resend: the same invite as a fresh schedule, to nudge participants when nothing changed.
router.post(
  "/meetings/:id/resend",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfMeeting),
  async (req, res, next) => {
    try {
      const meeting = await prisma.tripMeeting.findUnique({
        where: { id: req.params.id },
        include: { trip: { include: { participants: { select: emailParticipantSelect } } } },
      });
      if (!meeting) return res.status(404).json({ error: "Not found" });
      if (meeting.cancelledAt) return res.status(400).json({ error: "This meeting has been cancelled." });

      const emailResult = await sendMeetingEmail(
        meeting.trip,
        meeting,
        "Here's a reminder about an upcoming trip meeting."
      );
      res.json({ sent: !!emailResult?.sent, manual: emailResult?.manual });
    } catch (err) {
      next(err);
    }
  }
);

// Soft-cancel (see the TripMeeting schema comment). Re-cancelling re-sends the cancellation notice
// rather than erroring, so an admin can re-notify someone who missed it.
router.post(
  "/meetings/:id/cancel",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfMeeting),
  async (req, res, next) => {
    try {
      const existing = await prisma.tripMeeting.findUnique({
        where: { id: req.params.id },
        include: { trip: { include: { participants: { select: emailParticipantSelect } } } },
      });
      if (!existing) return res.status(404).json({ error: "Not found" });

      const cancelled = await prisma.tripMeeting.update({
        where: { id: req.params.id },
        data: { cancelledAt: existing.cancelledAt || new Date() },
      });
      const emailResult = await sendMeetingEmail(
        existing.trip,
        cancelled,
        "A trip meeting has been cancelled.",
        {
          cancelled: true,
        }
      );
      res.json({ ...cancelled, manualEmail: emailResult?.manual });
    } catch (err) {
      next(err);
    }
  }
);

// Hard delete -- for correcting a meeting created by mistake. Refused once cancelled (a notice
// already went out). Allowed on a never-cancelled meeting even though creating it sent an invite:
// cancel announces a cancellation nobody should see, so it is not for undoing a data-entry error.
router.delete(
  "/meetings/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfMeeting),
  async (req, res, next) => {
    try {
      const existing = await prisma.tripMeeting.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.cancelledAt) {
        return res.status(400).json({ error: "This meeting was already cancelled; nothing left to delete." });
      }
      await prisma.tripMeeting.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
