// Public, unauthenticated application-submission surface for Trips
// (#252) -- plain id-addressed and private applicationShareToken-
// addressed, split out of the former publicTrips.js (#271 Finding).
// Mounted at the same /api/public/trips prefix as publicTrips.js
// (discovery) from server.js, not a separate API surface.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { getSettings } = require("../utils/publicTripShared");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");

const router = express.Router();

// #327 Finding 4: every string here was unbounded and responses was an
// open record -- an unauthenticated caller could write arbitrarily large
// rows to TripApplication with nothing but the shared /api/public rate
// bucket (120/min) in the way. name-sized fields capped at 100, free text
// at 5,000, everything else to a size that's generous for a real value
// but not for an attack payload.
const NAME_MAX = 100;
const FREE_TEXT_MAX = 5000;
const SHORT_FIELD_MAX = 200;
const PHONE_MAX = 30;
const RESPONSES_MAX_QUESTIONS = 100; // a real application template has a handful to a few dozen
const RESPONSE_VALUE_MAX = FREE_TEXT_MAX;
const RESPONSE_ARRAY_MAX_ITEMS = 50; // checkboxes-type answer -- every option checked

const applicationSchema = z.object({
  firstName: z.string().min(1).max(NAME_MAX),
  lastName: z.string().min(1).max(NAME_MAX),
  email: z.string().email().max(SHORT_FIELD_MAX),
  phone: z.string().max(PHONE_MAX).optional().nullable(),
  // Structured mailing address -- optional strings, no format validation,
  // matching SendingParty's own looseness. Rendered on the public form
  // only when ChurchSettings.collectApplicantAddress is on, but accepted
  // here regardless of that setting's current value (same reasoning as
  // every other optional field on this schema -- the setting controls
  // what the form shows, not what the server will accept).
  addressLine1: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  addressLine2: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  city: z.string().max(NAME_MAX).optional().nullable(),
  stateProvinceRegion: z.string().max(NAME_MAX).optional().nullable(),
  postalCode: z.string().max(PHONE_MAX).optional().nullable(),
  country: z.string().max(NAME_MAX).optional().nullable(),
  // Structured emergency contact -- same looseness/reasoning as the
  // address fields above. Rendered only when ChurchSettings.
  // collectEmergencyContact is on, but accepted here regardless.
  emergencyContactFirstName: z.string().max(NAME_MAX).optional().nullable(),
  emergencyContactLastName: z.string().max(NAME_MAX).optional().nullable(),
  emergencyContactPhone: z.string().max(PHONE_MAX).optional().nullable(),
  emergencyContactEmail: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  // Always collected and always required now -- no per-trip or
  // church-wide setting gates it (see TripParticipant.dateOfBirth's own
  // schema comment). A real structured field, not a template question,
  // since the minor determination needs something a server check can
  // compare against the trip's own startDate.
  dateOfBirth: z.coerce.date(),
  // Required only when dateOfBirth computes as a minor for this trip
  // (checked below, after parsing, since that check needs the trip's own
  // startDate -- not available to the schema itself). Accepted here
  // regardless of age so an adult applicant's request isn't rejected for
  // omitting fields that don't apply to them.
  parentGuardianFirstName: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianLastName: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianRelationship: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianPhone: z.string().max(PHONE_MAX).optional().nullable(),
  parentGuardianEmail: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  // A checkboxes-type question answers with a string array (every option
  // checked); every other type answers with a plain string -- see
  // utils/applicationQuestions.js's QUESTION_TYPES.
  responses: z
    .record(
      z.string().max(NAME_MAX),
      z.union([
        z.string().max(RESPONSE_VALUE_MAX),
        z.array(z.string().max(RESPONSE_VALUE_MAX)).max(RESPONSE_ARRAY_MAX_ITEMS),
      ])
    )
    .refine((r) => Object.keys(r).length <= RESPONSES_MAX_QUESTIONS, {
      message: `responses cannot have more than ${RESPONSES_MAX_QUESTIONS} entries`,
    })
    .optional(),
});

// #327 Finding 4: same bot-deterrent precedent as publicSubscribe.js's
// own rate limiter, plus a honeypot. The 120/min shared /api/public
// bucket (server.js) never meaningfully slowed a scripted submitter down
// -- this is a tighter ceiling specifically on the two routes with a real
// write (and a free-tier Postgres row budget) behind them.
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
});

async function createApplication(trip, settings, body, res) {
  // Honeypot: a field the real form never shows (hidden off-screen, no
  // label) and a real applicant never fills. A caller that fills it is a
  // bot that fills every input it finds -- short-circuit to the exact
  // same success response a real submission gets, before validation even
  // runs, same "never signal a difference" principle as
  // auth.js's password-setup/request. Nothing is written.
  if (body?.website) {
    return res.status(201).json({ submitted: true });
  }
  const data = applicationSchema.parse(body);
  // Parent/guardian info is required exactly when the submitted date of
  // birth computes as a minor for this trip (isMinorForTrip compares
  // against the trip's own startDate) -- not gated by any admin setting,
  // since the point is this is never missed regardless of whether anyone
  // predicted a minor would apply.
  if (isMinorForTrip(data.dateOfBirth, trip.startDate)) {
    const missingParentGuardianField = !(
      data.parentGuardianFirstName &&
      data.parentGuardianLastName &&
      data.parentGuardianRelationship &&
      data.parentGuardianPhone &&
      data.parentGuardianEmail
    );
    if (missingParentGuardianField) {
      return res
        .status(400)
        .json({ error: "Parent/guardian information is required for an applicant under 18." });
    }
  }
  await prisma.tripApplication.create({
    data: {
      tripId: trip.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      city: data.city || null,
      stateProvinceRegion: data.stateProvinceRegion || null,
      postalCode: data.postalCode || null,
      country: data.country || null,
      dateOfBirth: data.dateOfBirth || null,
      parentGuardianFirstName: data.parentGuardianFirstName || null,
      parentGuardianLastName: data.parentGuardianLastName || null,
      parentGuardianRelationship: data.parentGuardianRelationship || null,
      parentGuardianPhone: data.parentGuardianPhone || null,
      parentGuardianEmail: data.parentGuardianEmail || null,
      emergencyContactFirstName: data.emergencyContactFirstName || null,
      emergencyContactLastName: data.emergencyContactLastName || null,
      emergencyContactPhone: data.emergencyContactPhone || null,
      emergencyContactEmail: data.emergencyContactEmail || null,
      responses: data.responses || {},
    },
  });
  res.status(201).json({ submitted: true });
}

// POST /api/public/trips/:id/apply -- plain id-addressed submission.
router.post("/:id/apply", applyLimiter, requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const publiclyDiscoverable = isFeatureEnabled(settings?.enabledFeatures, "publicTripDiscovery");

    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        isPublic: true,
        startDate: true,
        partner: { select: { isRestricted: true } },
      },
    });
    if (!trip || trip.partner?.isRestricted) return res.status(404).json({ error: "Not found" });
    if (!publiclyDiscoverable || !trip.isPublic || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, settings, req.body, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/public/trips/by-token/:token/apply -- private-link submission.
// Works for a restricted partner (masked view already shown on
// publicTrips.js's own GET /by-token/:token); still 404s on a bad token
// or wrong status.
router.post("/by-token/:token/apply", applyLimiter, requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPrivateApplicationLinks) return res.status(404).json({ error: "Not found" });

    const trip = await prisma.trip.findUnique({
      where: { applicationShareToken: req.params.token },
      select: { id: true, status: true, startDate: true },
    });
    if (!trip || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, settings, req.body, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
