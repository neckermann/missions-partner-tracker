const express = require("express");
const { optionalWebAddress } = require("../utils/webAddress");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { APPLICATION_QUESTION_SCHEMA, REQUIREMENT_TEMPLATE_SCHEMA } = require("../utils/applicationQuestions");
const { loadChurchLists, replaceQuestions, replaceRequirementItems } = require("../utils/tripTemplates");

const router = express.Router();
router.use(requireAuth);

// Trips (#252) church-wide settings: donation instructions (§13), donor-contact opt-in (§6) and
// the two private-link gates (§4/§6). Gated by requireFeature("trips") alone, so it is configurable
// before the public-facing bits are on (as GroupMe/Joshua Project).
const tripsSettingsSelect = {
  onlineGivingUrl: true,
  onlineGivingInstructions: true,
  collectDonorContactInfo: true,
  collectApplicantAddress: true,
  collectEmergencyContact: true,
  allowPrivateApplicationLinks: true,
  allowPublicSupportRaisingLinks: true,
  enableTripBudgeting: true,
};

const tripsSettingsSchema = z.object({
  onlineGivingUrl: optionalWebAddress(),
  onlineGivingInstructions: z.string().optional().nullable(),
  collectDonorContactInfo: z.boolean().optional(),
  collectApplicantAddress: z.boolean().optional(),
  collectEmergencyContact: z.boolean().optional(),
  allowPrivateApplicationLinks: z.boolean().optional(),
  allowPublicSupportRaisingLinks: z.boolean().optional(),
  enableTripBudgeting: z.boolean().optional(),
  // Same shape as Trip.applicationQuestions (utils/applicationQuestions.js). tripApplicationTemplate is
  // the church-wide layer rendered ahead of each trip's own questions; tripQuestionLibrary is a
  // copy-from-here picker source, never rendered on a form.
  tripApplicationTemplate: APPLICATION_QUESTION_SCHEMA.optional().nullable(),
  tripQuestionLibrary: APPLICATION_QUESTION_SCHEMA.optional().nullable(),
  // Same shape as Trip's requirements (REQUIREMENT_TEMPLATE_SCHEMA in utils/applicationQuestions.js).
  // tripRequirementTemplate auto-copies onto every trip; tripRequirementLibrary is picked per trip and
  // never auto-copied.
  tripRequirementTemplate: REQUIREMENT_TEMPLATE_SCHEMA.optional().nullable(),
  tripRequirementLibrary: REQUIREMENT_TEMPLATE_SCHEMA.optional().nullable(),
});

// #327 Finding 2: church-wide trip configuration. SPEC.md § 5.1 makes Settings a flat 403 for a Trip
// Leader, who has no use for it (their trip's questions/requirements come from trip-scoped routes).
router.get(
  "/trips",
  requireFeature("trips"),
  requireRole("admin", "editor", "viewer"),
  async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: tripsSettingsSelect,
      });
      const lists = await loadChurchLists();
      res.json({
        ...(settings || {
          onlineGivingUrl: null,
          onlineGivingInstructions: null,
          collectDonorContactInfo: false,
          collectApplicantAddress: true,
          collectEmergencyContact: true,
          allowPrivateApplicationLinks: false,
          allowPublicSupportRaisingLinks: false,
          enableTripBudgeting: false,
        }),
        ...lists,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/trips", requireFeature("trips"), requireRole("admin"), async (req, res, next) => {
  try {
    const {
      tripApplicationTemplate,
      tripQuestionLibrary,
      tripRequirementTemplate,
      tripRequirementLibrary,
      ...data
    } = tripsSettingsSchema.parse(req.body);
    // #394: the four lists are real rows; each one sent replaces that list whole, in its order.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...data, updatedById: req.user.id },
        update: { ...data, updatedById: req.user.id },
        select: tripsSettingsSelect,
      });
      if (tripApplicationTemplate) await replaceQuestions(tx, "template", null, tripApplicationTemplate);
      if (tripQuestionLibrary) await replaceQuestions(tx, "library", null, tripQuestionLibrary);
      if (tripRequirementTemplate) await replaceRequirementItems(tx, "template", tripRequirementTemplate);
      if (tripRequirementLibrary) await replaceRequirementItems(tx, "library", tripRequirementLibrary);
      return row;
    });
    res.json({ ...updated, ...(await loadChurchLists()) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
