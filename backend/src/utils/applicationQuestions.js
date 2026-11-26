const { z } = require("zod");

// One shared shape for Trip.applicationQuestions, ChurchSettings.tripApplicationTemplate
// and ChurchSettings.tripQuestionLibrary: all are an ordered, admin-defined list of
// application questions used in different places (per-trip, global default, reusable library).
const QUESTION_TYPES = ["text", "textarea", "select", "checkboxes", "date"];

// `type` is optional; missing means "text", so older free-text questions keep working.
// `options` only matters for "select"/"checkboxes".
const APPLICATION_QUESTION_SCHEMA = z.array(
  z
    .object({
      id: z.string(),
      label: z.string().min(1),
      required: z.boolean().optional(),
      type: z.enum(QUESTION_TYPES).optional(),
      options: z.array(z.string().min(1)).optional(),
    })
    .refine((q) => !["select", "checkboxes"].includes(q.type) || (q.options && q.options.length > 0), {
      message: "Multiple-choice and checkbox questions need at least one option",
      path: ["options"],
    })
);

// Same shape-once reasoning for ChurchSettings.tripRequirementTemplate: an ordered
// checklist auto-copied onto every new, actively-recruiting trip (see trips.js POST /).
// A different shape (kind/bodyText/reminderLeadDays), so its own definition.
const REQUIREMENT_KINDS = ["document", "task", "esignature"];

const REQUIREMENT_TEMPLATE_SCHEMA = z.array(
  z.object({
    id: z.string(),
    label: z.string().min(1),
    kind: z.enum(REQUIREMENT_KINDS).optional(),
    bodyText: z.string().optional().nullable(),
    reminderLeadDays: z.number().int().positive().optional().nullable(),
    // Carried onto the TripRequirement row this entry copies into (trips.js POST /, tripRequirements.js POST /:id/requirements).
    minorsOnly: z.boolean().optional(),
  })
);

module.exports = {
  QUESTION_TYPES,
  APPLICATION_QUESTION_SCHEMA,
  REQUIREMENT_KINDS,
  REQUIREMENT_TEMPLATE_SCHEMA,
};
