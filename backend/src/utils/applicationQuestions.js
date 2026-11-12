const { z } = require("zod");

// One shared shape for Trip.applicationQuestions, ChurchSettings.tripApplicationTemplate,
// and ChurchSettings.tripQuestionLibrary -- all three are the same kind of
// thing (an ordered, admin-defined list of application questions), just
// used in different places (per-trip, the global default layer, and a
// reusable copy-from-here library). Defining the shape once here, instead
// of three times, is what keeps them from drifting out of sync.
const QUESTION_TYPES = ["text", "textarea", "select", "checkboxes"];

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

module.exports = { QUESTION_TYPES, APPLICATION_QUESTION_SCHEMA };
