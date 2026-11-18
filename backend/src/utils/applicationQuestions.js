const { z } = require("zod");

// One shared shape for Trip.applicationQuestions, ChurchSettings.tripApplicationTemplate,
// and ChurchSettings.tripQuestionLibrary -- all three are the same kind of
// thing (an ordered, admin-defined list of application questions), just
// used in different places (per-trip, the global default layer, and a
// reusable copy-from-here library). Defining the shape once here, instead
// of three times, is what keeps them from drifting out of sync.
const QUESTION_TYPES = ["text", "textarea", "select", "checkboxes", "date"];

// `type` is optional -- missing/undefined means "text", so every question
// saved before this field existed (plain free-text, no type at all) keeps
// rendering and validating exactly as before. `options` only matters for
// "select"/"checkboxes" -- free text ("text"/"textarea") never uses it.
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

// Same "define once, reuse everywhere" reasoning, for
// ChurchSettings.tripRequirementTemplate -- an ordered, admin-defined
// checklist of requirements auto-copied onto every newly-created,
// actively-recruiting trip (see trips.js's POST / for where the copy
// happens). A different shape from the question schema above (kind/
// bodyText/reminderLeadDays instead of type/options/required), so its
// own definition, not a reuse of APPLICATION_QUESTION_SCHEMA.
const REQUIREMENT_KINDS = ["document", "task", "esignature"];

const REQUIREMENT_TEMPLATE_SCHEMA = z.array(
  z.object({
    id: z.string(),
    label: z.string().min(1),
    kind: z.enum(REQUIREMENT_KINDS).optional(),
    bodyText: z.string().optional().nullable(),
    reminderLeadDays: z.number().int().positive().optional().nullable(),
    // #278 -- carried onto the real TripRequirement row this template/
    // library entry copies into (see trips.js's POST / and
    // tripRequirements.js's POST /:id/requirements).
    minorsOnly: z.boolean().optional(),
  })
);

module.exports = {
  QUESTION_TYPES,
  APPLICATION_QUESTION_SCHEMA,
  REQUIREMENT_KINDS,
  REQUIREMENT_TEMPLATE_SCHEMA,
};
