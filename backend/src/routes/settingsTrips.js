const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { APPLICATION_QUESTION_SCHEMA, REQUIREMENT_TEMPLATE_SCHEMA } = require("../utils/applicationQuestions");

// #271 Finding: split out of the former settings.js -- see
// settingsGroupMe.js's own header comment for the full reasoning.
const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Trips (#252) -- church-wide settings for the whole feature area: the
// donation-instructions fields (§13), the donor-contact opt-in (§6), and
// the two private-link gates (§4/§6). Gated by requireFeature("trips")
// alone -- reachable to configure as soon as the backend feature is on,
// same posture GroupMe/Joshua Project settings already take (configurable
// before the more specific public-facing bits are turned on).
const tripsSettingsSelect = {
  onlineGivingUrl: true,
  onlineGivingInstructions: true,
  collectDonorContactInfo: true,
  collectApplicantAddress: true,
  collectEmergencyContact: true,
  collectDateOfBirth: true,
  requireDateOfBirth: true,
  allowPrivateApplicationLinks: true,
  allowPublicSupportRaisingLinks: true,
  enableTripBudgeting: true,
  tripApplicationTemplate: true,
  tripQuestionLibrary: true,
  tripRequirementTemplate: true,
  tripRequirementLibrary: true,
};

const tripsSettingsSchema = z.object({
  onlineGivingUrl: z.string().trim().optional().nullable(),
  onlineGivingInstructions: z.string().optional().nullable(),
  collectDonorContactInfo: z.boolean().optional(),
  collectApplicantAddress: z.boolean().optional(),
  collectEmergencyContact: z.boolean().optional(),
  collectDateOfBirth: z.boolean().optional(),
  requireDateOfBirth: z.boolean().optional(),
  allowPrivateApplicationLinks: z.boolean().optional(),
  allowPublicSupportRaisingLinks: z.boolean().optional(),
  enableTripBudgeting: z.boolean().optional(),
  // Same shared shape as Trip.applicationQuestions (trips.js) -- see
  // utils/applicationQuestions.js. tripApplicationTemplate is the
  // church-wide layer every trip's form renders ahead of its own
  // questions; tripQuestionLibrary is a pure copy-from-here picker
  // source, never itself rendered on any form.
  tripApplicationTemplate: APPLICATION_QUESTION_SCHEMA.optional().nullable(),
  tripQuestionLibrary: APPLICATION_QUESTION_SCHEMA.optional().nullable(),
  // Same shared shape as Trip's own requirements, see
  // utils/applicationQuestions.js's REQUIREMENT_TEMPLATE_SCHEMA.
  // tripRequirementTemplate auto-copies onto every trip;
  // tripRequirementLibrary is the per-trip-picked equivalent of
  // tripQuestionLibrary above, never auto-copied anywhere.
  tripRequirementTemplate: REQUIREMENT_TEMPLATE_SCHEMA.optional().nullable(),
  tripRequirementLibrary: REQUIREMENT_TEMPLATE_SCHEMA.optional().nullable(),
});

router.get("/trips", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: tripsSettingsSelect,
    });
    res.json(
      settings || {
        onlineGivingUrl: null,
        onlineGivingInstructions: null,
        collectDonorContactInfo: false,
        collectApplicantAddress: true,
        collectEmergencyContact: true,
        collectDateOfBirth: true,
        requireDateOfBirth: false,
        allowPrivateApplicationLinks: false,
        allowPublicSupportRaisingLinks: false,
        enableTripBudgeting: false,
        tripApplicationTemplate: [],
        tripQuestionLibrary: [],
        tripRequirementTemplate: [],
        tripRequirementLibrary: [],
      }
    );
  } catch (err) {
    next(err);
  }
});

router.put("/trips", requireFeature("trips"), requireRole("admin"), async (req, res, next) => {
  try {
    const data = tripsSettingsSchema.parse(req.body);
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: tripsSettingsSelect,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
