// #271 Finding 1: split out of trips.js, which had grown into a route-
// file outlier (1389 lines, 40% bigger than the next-largest route
// file). Mounted at the same /api/trips prefix as trips.js itself
// (server.js) -- a sibling sub-resource router, not a separate API
// surface.
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { sendMeetingEmail, emailParticipantSelect } = require("../utils/tripEmails");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
router.use(requireFeature("trips"));

// ---- Meetings ----

const meetingInputSchema = z.object({
  startAt: z.coerce.date().optional(),
  title: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  // An empty string (clearing the field from a form input) is treated
  // the same as omitting it -- url() rejects "" outright, and clearing
  // a link should mean "no link," not a validation error.
  meetingLink: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  agenda: z.string().optional().nullable(),
});

router.post("/:id/meetings", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = meetingInputSchema.required({ startAt: true }).parse(req.body);
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: emailParticipantSelect } },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });

    const meeting = await prisma.tripMeeting.create({ data: { ...data, tripId: trip.id } });
    await sendMeetingEmail(trip, meeting, "A meeting has been scheduled.");
    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// Reschedule-resend: compares incoming startAt/location/meetingLink
// against the row's current stored values before applying the update --
// a change to any of those three counts as a reschedule (a participant
// needs to know the new time, the new place, or that the join link
// changed) and triggers a resend; an agenda-only edit updates silently,
// same precedent this already followed for the field it replaced.
router.put("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
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

    if (rescheduled) {
      await sendMeetingEmail(existing.trip, updated, "Your trip meeting has been updated.");
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Explicit resend -- same invite content as a fresh schedule, for when
// nothing about the meeting changed but an admin still wants to nudge
// participants (a late addition to the team, someone who says they
// never got it) without waiting on, or faking, a reschedule.
router.post("/meetings/:id/resend", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const meeting = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: { select: emailParticipantSelect } } } },
    });
    if (!meeting) return res.status(404).json({ error: "Not found" });
    if (meeting.cancelledAt) return res.status(400).json({ error: "This meeting has been cancelled." });

    await sendMeetingEmail(meeting.trip, meeting, "Here's a reminder about an upcoming trip meeting.");
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// Soft-cancel -- see the TripMeeting schema comment for why this isn't a
// delete. Idempotent-ish: cancelling an already-cancelled meeting just
// re-sends the cancellation notice rather than erroring, since an admin
// who clicks it twice (or needs to re-notify a participant who missed
// the first one) shouldn't be blocked.
router.post("/meetings/:id/cancel", requireRole("admin", "editor"), async (req, res, next) => {
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
    await sendMeetingEmail(existing.trip, cancelled, "A trip meeting has been cancelled.", {
      cancelled: true,
    });
    res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

// Hard delete -- for correcting a meeting that was created by mistake.
// Refused once a meeting has already been cancelled (which already sent
// its own notice -- deleting on top of that would just be a second,
// redundant state change with nothing left for it to accomplish).
// Deliberately still allowed on a never-cancelled meeting even though
// creating one already sent an invite -- an admin correcting a real
// mistake (wrong trip, duplicate entry) shouldn't be forced through
// "cancel" (which announces a cancellation nobody should see) just to
// remove it; cancel is for calling off a real meeting, not for undoing
// a data-entry error.
router.delete("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
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
});

module.exports = router;
