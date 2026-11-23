// #271 Finding 1: split out of trips.js -- see tripMeetings.js's own
// header comment for the full reasoning. Covers Applications (pending
// participants) and Participants (direct team add + admin edit) -- kept
// in one file rather than two, since approving an application *becomes*
// a participant through the same tx.tripParticipant.create path the
// direct-add route uses, and splitting them further would duplicate the
// shared schema/helpers without buying any real separation.
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, requireTripScope } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

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
router.use(requireAuth); // everything below requires a logged-in user
router.use(requireFeature("trips"));

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, allowPublicSupportRaisingLinks: true, inboundEmailAddress: true },
  });
}

// ---- Applications ----

router.get("/:id/applications", requireTripScope("id"), async (req, res, next) => {
  try {
    const applications = await prisma.tripApplication.findMany({ where: { tripId: req.params.id } });
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
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope(tripIdOfApplication),
  async (req, res, next) => {
    try {
      const { status, declinedReason } = z
        .object({
          status: z.enum(["approved", "declined", "pending"]),
          declinedReason: z.string().optional().nullable(),
        })
        .parse(req.body);
      // meetings/requirements included alongside trip -- needed for
      // sendLateJoinerCatchUpEmails below, same shape POST /:id/participants
      // already loads its own trip with.
      const application = await prisma.tripApplication.findUnique({
        where: { id: req.params.id },
        include: { trip: { include: { meetings: true, requirements: true } } },
      });
      if (!application) return res.status(404).json({ error: "Not found" });

      // Fetched once, before the transaction -- decides both whether this
      // new participant gets a support-raising shareToken at all (below)
      // and whether the team-invite email fires (after the transaction).
      const settings = await getSettings();

      const updated = await prisma.$transaction(async (tx) => {
        const app = await tx.tripApplication.update({
          where: { id: req.params.id },
          data: {
            status,
            reviewedAt: new Date(),
            reviewedById: req.user.id,
            // Admin-only context for a decline, never shown to the
            // applicant. Reconsidering back to "pending" (the undo path)
            // clears it -- a reopened application has no reason attached
            // to it anymore, since the prior decline no longer stands.
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
              // Defaulted to the trip's own goal -- same reasoning as the
              // direct-add route (defaultParticipantGoal), just inlined
              // since there's no per-participant override to weigh against
              // here (approval carries no participant-shaped input of its
              // own to read one from).
              supportRaisingGoal: application.trip.supportRaisingGoal,
              // Auto-generated here, not left for a later manual admin
              // click -- the church-wide setting already answers "do we do
              // this at all," so a second per-participant step is pure
              // friction. See the team-invite email below, which is the
              // one place this new link actually reaches the participant.
              shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
            },
          });
          return { app, participant };
        }
        return { app, participant: null };
      });

      // Trip-dates team invite (§9) -- fires once, outside the
      // transaction (an email failure shouldn't roll back the approval).
      // Previously carried zero links at all -- a participant had no way to
      // ever receive their own access link or support-raising link
      // automatically. Now carries both, in one email, rather than a
      // second dedicated send for the support-raising link.
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
        }
      }

      // Same late-joiner catch-up as the direct-add route below -- approving
      // an application is a separate creation path (its own tx.create above)
      // that previously got none of this. Not gated on startDate/endDate
      // existing (unlike the welcome email above, which needs them for its
      // .ics) -- sendLateJoinerCatchUpEmails only needs trip.status itself.
      if (updated.participant) {
        await sendLateJoinerCatchUpEmails(application.trip, updated.participant);
      }

      // The frontend navigates straight to the new participant's own
      // detail page on a successful approval (AdminTripTeam.jsx's
      // handleReview checks result?.participant) -- this was silently
      // never possible before, since only the application itself was
      // returned here. Never caught: no existing test asserted on the
      // response shape, only status 200 (found via e2e/trip-team-table-
      // modal.spec.js, the first real coverage of this page).
      res.json({ ...updated.app, participant: updated.participant });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Team: direct admin add ----

router.post(
  "/:id/participants",
  requireRole("admin", "editor", "tripLeader"),
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

      // A participant on a completed trip is a backfill by construction
      // (recruiting never happens for an already-finished trip) and
      // legitimately has none of this on file; a participant added to any
      // other trip status is being asserted as a real, reachable team
      // member the moment they're added -- application approval already
      // enforces this, this route previously didn't.
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
          // Same auto-generation as the application-approval path -- see
          // that route's own comment for why this isn't left as a manual
          // admin step.
          shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
        },
      });

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
        }
      }

      // A participant added after meetings or document requirements already
      // exist would otherwise never learn about them -- the welcome email
      // above only covers the trip dates. Shared with the application-
      // approval route (PUT /applications/:id), which needs the exact same
      // backfill through a different creation path.
      await sendLateJoinerCatchUpEmails(trip, participant);

      res.status(201).json(participant);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/trips/participants/:id/generate-support-raising-link --
// "Regenerate" on the frontend once a token already exists (overwrite-
// as-revocation, same precedent Trip.applicationShareToken's own
// regenerate already uses) -- this route itself needed no change for
// that, only the frontend's own !shareToken gating, which previously
// hid the button forever once a token existed.
router.post(
  "/participants/:id/generate-support-raising-link",
  requireRole("admin", "editor", "tripLeader"),
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
  isLeader: z.boolean().optional(),
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Address/emergency contact -- previously write-once (copied from the
  // originating TripApplication on approval, see the approval route
  // above) with no admin edit path afterward, and no way at all for a
  // directly-added participant (no application) to ever get these set.
  // Now plain editable record-keeping, same trust level as
  // firstName/phone/etc. above.
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

// PUT /api/trips/participants/:id -- one combined admin route for
// everything an admin can edit on a participant's behalf: basic contact
// details (never gated -- this is plain record-keeping, independent of
// whether the church uses public support-raising pages at all) and
// story/photo (editing on their behalf what a participant could also
// edit themselves via the self-service route -- same fields, different
// trust boundary: this one is admin-authenticated, not signed-access-
// token-authenticated).
router.put(
  "/participants/:id",
  requireRole("admin", "editor", "tripLeader"),
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

      // No omit needed -- the raw photo bytes live in their own table now,
      // never selected here at all.
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
  requireRole("admin", "editor", "tripLeader"),
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

// ---- Documents: the one route here that's about requesting one from a
// participant (a text message, no file handling), not storing one --
// see trips.js for the actual TripDocument CRUD.
router.post(
  "/:tripId/participants/:id/request-documents",
  requireFeature("outboundEmail"),
  requireFeature("inboundEmail"),
  requireRole("admin", "editor", "tripLeader"),
  requireTripScope("tripId"),
  async (req, res, next) => {
    try {
      const { message } = z.object({ message: z.string().min(1) }).parse(req.body);
      const settings = await getSettings();
      if (!settings?.inboundEmailAddress) {
        return res.status(400).json({ error: "Set an inbound email address under Settings → Email first" });
      }
      const participant = await prisma.tripParticipant.findUnique({ where: { id: req.params.id } });
      if (!participant) return res.status(404).json({ error: "Not found" });

      const result = await sendParticipantEmail(participant, "Document request", message, {
        replyTo: settings.inboundEmailAddress,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
