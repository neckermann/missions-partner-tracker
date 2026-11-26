// Public, unauthenticated application-submission surface for Trips (#252): id-addressed and
// private applicationShareToken-addressed. Mounted at /api/public/trips, like publicTrips.js.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { getSettings } = require("../utils/publicTripShared");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");
const { notifyTripTeamOfApplication } = require("../utils/tripApplicationNotice");

const { loadApplicantQuestions, answerRows } = require("../utils/tripTemplates");

const router = express.Router();

// #327 Finding 4: bounds on every string and on `responses`, so an unauthenticated caller cannot
// write arbitrarily large TripApplication rows past the shared /api/public rate bucket (120/min).
// Name-sized fields cap at 100, free text at 5,000.
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
  // Structured mailing address: optional strings with no format validation, like SendingParty.
  // The setting controls what the form shows, not what the server accepts.
  addressLine1: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  addressLine2: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  city: z.string().max(NAME_MAX).optional().nullable(),
  stateProvinceRegion: z.string().max(NAME_MAX).optional().nullable(),
  postalCode: z.string().max(PHONE_MAX).optional().nullable(),
  country: z.string().max(NAME_MAX).optional().nullable(),
  // Structured emergency contact: same looseness as the address above.
  emergencyContactFirstName: z.string().max(NAME_MAX).optional().nullable(),
  emergencyContactLastName: z.string().max(NAME_MAX).optional().nullable(),
  emergencyContactPhone: z.string().max(PHONE_MAX).optional().nullable(),
  emergencyContactEmail: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  // Always collected and required (see TripParticipant.dateOfBirth in schema.prisma). A structured
  // field, not a template question, so the server can compare it to the trip's startDate.
  dateOfBirth: z.coerce.date(),
  // Required only when dateOfBirth computes as a minor for this trip (checked after parsing, since
  // it needs the trip's startDate). Accepted regardless so adult applicants aren't rejected.
  parentGuardianFirstName: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianLastName: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianRelationship: z.string().max(NAME_MAX).optional().nullable(),
  parentGuardianPhone: z.string().max(PHONE_MAX).optional().nullable(),
  parentGuardianEmail: z.string().max(SHORT_FIELD_MAX).optional().nullable(),
  // A checkboxes-type question answers with a string array; every other type with a string (see
  // QUESTION_TYPES in utils/applicationQuestions.js).
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

// #327 Finding 4: a tighter ceiling than the shared /api/public bucket (server.js), plus a
// honeypot, on the two routes with a real write behind them.
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
});

async function createApplication(trip, settings, body, res) {
  // Honeypot: a field the real form never shows. A caller that fills it is a bot; return the exact
  // same success response as a real submission, before validation (never signal a difference, as in
  // auth.js's password-setup/request). Nothing is written.
  if (body?.website) {
    return res.status(201).json({ submitted: true });
  }
  const data = applicationSchema.parse(body);
  // Parent/guardian info is required exactly when the date of birth computes as a minor for this
  // trip (isMinorForTrip), not gated by any admin setting.
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
  const application = await prisma.tripApplication.create({
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
      // #394: each answer is its own row, kept with the question's wording at the time.
      answers: { create: answerRows(await loadApplicantQuestions(trip.id), data.responses) },
    },
  });
  // Tell the trip's team when email is on (best-effort; never fails the submission).
  await notifyTripTeamOfApplication(trip.id, application);
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

// POST /api/public/trips/by-token/:token/apply -- private-link submission. Works for a restricted
// partner (masked view shown by publicTrips.js GET /by-token/:token); 404s on a bad token or status.
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
