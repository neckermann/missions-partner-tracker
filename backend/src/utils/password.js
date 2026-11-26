const { z } = require("zod");

// One shared schema so every place that sets a password (first-run setup,
// change-password, welcome-link completion, admin create/reset) enforces the same 8-128 range.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

module.exports = { passwordSchema };
