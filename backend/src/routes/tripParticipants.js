// Applications (pending participants) and Participants (direct add + admin edit), in one file because
// approving an application becomes a participant through the same tx.tripParticipant.create path as
// the direct-add route.
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requireTripScope } = require("../middleware/requireAuth");
const { isSeatOnly } = require("../utils/seatTripView");
const { requireFeature } = require("../middleware/requireFeature");
const { ANSWERS_INCLUDE } = require("../utils/tripTemplates");

async function tripIdOfApplication(req) {
  const row = await prisma.tripApplication.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}
async function tripIdOfParticipant(req) {
  const row = await prisma.tripParticipant.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}
const { generateShareToken, buildTripParticipantAccessUrl } = require("../utils/tripAccessToken");
const {
  sendParticipantEmail,
  buildTeamWelcomeContent,
  buildTripDatesIcs,
  sendLateJoinerCatchUpEmails,
} = require("../utils/tripEmails");
const { isFeatureEnabled } = require("../utils/features");
const { decodePhotoDataUrl } = require("../utils/participantPhoto");
const { participantSchema, defaultParticipantGoal } = require("../utils/tripParticipantSchema");

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("trips"));

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, allowPublicSupportRaisingLinks: true },
  });
}

router.get("/:id/applications", requireTripScope("id"), async (req, res, next) => {
  try {
    // Applicants (declined and pending ones too) are not a care team seat's to read (#409).
    if (isSeatOnly(req.user, req.params.id)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const applications = await prisma.tripApplication.findMany({
      where: { tripId: req.params.id },
      include: { answers: ANSWERS_INCLUDE },
    });
    res.json(applications);
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/applications/:id -- approve/decline. Approving creates
// exactly one TripParticipant with applicationId set (the @unique
// constraint on that column rejects a second approval of the same
// application), copying firstName/lastName at that moment, and fires
// the trip-dates team invite (§9) once, only for a non-completed trip.
router.put(
  "/applications/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfApplication),
  async (req, res, next) => {
    try {
      const { status, declinedReason } = z
        .object({
          status: z.enum(["approved", "declined", "pending"]),
          declinedReason: z.string().optional().nullable(),
        })
        .parse(req.body);
      // meetings/requirements included for sendLateJoinerCatchUpEmails below.
      const application = await prisma.tripApplication.findUnique({
        where: { id: req.params.id },
        include: { trip: { include: { meetings: true, requirements: true } } },
      });
      if (!application) return res.status(404).json({ error: "Not found" });

      // Fetched once, before the transaction: decides whether this participant gets a support-raising
      // shareToken and whether the team invite fires afterwards.
      const settings = await getSettings();

      const updated = await prisma.$transaction(async (tx) => {
        const app = await tx.tripApplication.update({
          where: { id: req.params.id },
          data: {
            status,
            reviewedAt: new Date(),
            reviewedById: req.user.id,
            // Admin-only context for a decline, never shown to the applicant; reconsidering back to "pending"
            // clears it.
            declinedReason: status === "declined" ? declinedReason?.trim() || null : null,
          },
        });
        if (status === "approved") {
          const participant = await tx.tripParticipant.create({
            data: {
              tripId: application.tripId,
              applicationId: application.id,
              firstName: application.firstName,
              lastName: application.lastName,
              email: application.email,
              phone: application.phone,
              addressLine1: application.addressLine1,
              addressLine2: application.addressLine2,
              city: application.city,
              stateProvinceRegion: application.stateProvinceRegion,
              postalCode: application.postalCode,
              country: application.country,
              emergencyContactFirstName: application.emergencyContactFirstName,
              emergencyContactLastName: application.emergencyContactLastName,
              emergencyContactPhone: application.emergencyContactPhone,
              emergencyContactEmail: application.emergencyContactEmail,
              dateOfBirth: application.dateOfBirth,
              parentGuardianFirstName: application.parentGuardianFirstName,
              parentGuardianLastName: application.parentGuardianLastName,
              parentGuardianRelationship: application.parentGuardianRelationship,
              parentGuardianPhone: application.parentGuardianPhone,
              parentGuardianEmail: application.parentGuardianEmail,
              // Defaults to the trip's goal, as in the direct-add route (defaultParticipantGoal); no
              // per-participant override applies here.
              supportRaisingGoal: application.trip.supportRaisingGoal,
              // Auto-generated: the church-wide setting already answers "do we do this", so a manual
              // per-participant step is friction. The team-invite email below is where the link reaches them.
              shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
            },
          });
          return { app, participant };
        }
        return { app, participant: null };
      });

      // Trip-dates team invite (§9) -- fires once, outside the transaction (an email failure should not
      // roll back the approval). Carries both the access link and the support-raising link.
      let teamWelcomeEmail = null;
      if (
        updated.participant &&
        application.trip.status !== "completed" &&
        application.trip.startDate &&
        application.trip.endDate
      ) {
        if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
          await sendParticipantEmail(
            updated.participant,
            `You're on the team: ${application.trip.name || application.trip.type || "your trip"}`,
            buildTeamWelcomeContent(application.trip, updated.participant, { approved: true }),
            {
              attachments: [
                {
                  name: "trip-dates.ics",
                  content: Buffer.from(buildTripDatesIcs(application.trip)),
                  contentType: "text/calendar",
                },
              ],
            }
          );
        } else {
          // Outbound email off: the only place a newly-approved participant would otherwise get their access
          // link automatically. Same manualUrl shape as /participants/:id/request-access-link below, for the
          // frontend's ManualSendNotice.
          teamWelcomeEmail = { sent: false, manualUrl: buildTripParticipantAccessUrl(updated.participant) };
        }
      }

      // Same late-joiner catch-up as the direct-add route below. Not gated on startDate/endDate existing
      // (unlike the welcome email, which needs them for its .ics); sendLateJoinerCatchUpEmails needs
      // only trip.status.
      if (updated.participant) {
        await sendLateJoinerCatchUpEmails(application.trip, updated.participant);
      }

      // AdminTripTeam.jsx's handleReview navigates to the new participant using result?.participant.
      res.json({ ...updated.app, participant: updated.participant, teamWelcomeEmail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/participants",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = participantSchema
        .extend({ email: z.string().email().optional().nullable() })
        .parse(req.body);
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id },
        include: { meetings: true, requirements: true },
      });
      if (!trip) return res.status(404).json({ error: "Not found" });

      // A participant on a completed trip is a backfill (recruiting never happens for a finished trip)
      // and legitimately has none of this on file; on any other status they are a real, reachable team
      // member, as application approval already enforces.
      if (trip.status !== "completed" && (!data.firstName || !data.lastName || !data.email)) {
        return res.status(400).json({
          error: "First name, last name, and email are required for a participant on an active trip.",
        });
      }

      const settings = await getSettings();
      const participant = await prisma.tripParticipant.create({
        data: {
          ...data,
          tripId: trip.id,
          supportRaisingGoal: defaultParticipantGoal(data, trip.supportRaisingGoal),
          // Same auto-generation as the application-approval path.
          shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
        },
      });

      let teamWelcomeEmail = null;
      if (trip.status !== "completed" && trip.startDate && trip.endDate) {
        if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
          await sendParticipantEmail(
            participant,
            `You're on the team: ${trip.name || trip.type || "your trip"}`,
            buildTeamWelcomeContent(trip, participant),
            {
              attachments: [
                {
                  name: "trip-dates.ics",
                  content: Buffer.from(buildTripDatesIcs(trip)),
                  contentType: "text/calendar",
                },
              ],
            }
          );
        } else {
          // Outbound email off: the welcome email is where a newly added participant gets their access
          // link, so hand the admin the link to send themselves (same shape as approving an application).
          teamWelcomeEmail = { sent: false, manualUrl: buildTripParticipantAccessUrl(participant) };
        }
      }

      // Catches up a participant added after meetings or document requirements exist (the welcome email
      // covers only trip dates). Shared with PUT /applications/:id.
      await sendLateJoinerCatchUpEmails(trip, participant);

      res.status(201).json({ ...participant, teamWelcomeEmail });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/trips/participants/:id/generate-support-raising-link -- also "Regenerate" once a token
// exists (overwrite-as-revocation, like Trip.applicationShareToken).
router.post(
  "/participants/:id/generate-support-raising-link",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfParticipant),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings?.allowPublicSupportRaisingLinks) {
        return res.status(400).json({
          error: "Public support-raising links are turned off -- enable them in Trip settings first",
        });
      }
      const participant = await prisma.tripParticipant.update({
        where: { id: req.params.id },
        data: { shareToken: generateShareToken() },
        select: { shareToken: true },
      });
      res.json({ shareToken: participant.shareToken });
    } catch (err) {
      next(err);
    }
  }
);

const adminParticipantUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Address/emergency contact: plain editable record-keeping, same trust level as firstName/phone above.
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  emergencyContactFirstName: z.string().optional().nullable(),
  emergencyContactLastName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactEmail: z.string().optional().nullable(),
  // Optional here -- this is the admin-side edit of an existing
  // participant record, not the public application (where dateOfBirth is
  // always required -- see publicTripApplications.js).
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianFirstName: z.string().optional().nullable(),
  parentGuardianLastName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: z.string().optional().nullable(),
  parentGuardianEmail: z.string().optional().nullable(),
  story: z.string().optional().nullable(),
  photo: z.string().optional().nullable(),
  photoContentType: z.string().optional().nullable(),
});

// PUT /api/trips/participants/:id -- one admin route for everything an admin edits on a participant's
// behalf: contact details (never gated; plain record-keeping) and story/photo (also editable by the
// participant via the self-service route, but admin-authenticated rather than signed-token).
router.put(
  "/participants/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfParticipant),
  async (req, res, next) => {
    try {
      const { photo, photoContentType, ...rest } = adminParticipantUpdateSchema.parse(req.body);
      const data = { ...rest };
      if (photo) {
        const decoded = decodePhotoDataUrl(photo, photoContentType);
        data.photoBytesRow = { upsert: { create: { photo: decoded }, update: { photo: decoded } } };
      }
      if (photo && photoContentType) data.photoContentType = photoContentType;

      const participant = await prisma.tripParticipant.update({
        where: { id: req.params.id },
        data,
      });
      res.json(participant);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// POST /api/trips/participants/:id/request-access-link -- admin-triggered
// resend of a participant's own self-service link (distinct from the
// public, self-triggered §4a lost-link flow).
router.post(
  "/participants/:id/request-access-link",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfParticipant),
  async (req, res, next) => {
    try {
      const participant = await prisma.tripParticipant.findUnique({ where: { id: req.params.id } });
      if (!participant) return res.status(404).json({ error: "Not found" });
      const settings = await getSettings();
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        await sendParticipantEmail(
          participant,
          "Your trip access link",
          `Here's your trip link: ${buildTripParticipantAccessUrl(participant)}`
        );
        res.json({ sent: true });
      } else {
        res.json({ sent: false, manualUrl: buildTripParticipantAccessUrl(participant) });
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
