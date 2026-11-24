const { z } = require("zod");

// #327 Finding 11.5: four different places set a password (first-run
// setup, self-service change-password, the welcome-link completion, and
// an admin create/reset via users.js) and had each grown its own
// length/type check independently -- two of them (/setup,
// /change-password) only enforced a minimum, with no upper bound at all,
// while users.js's admin-set password had no bound either. One shared
// schema, so every path enforces the exact same 8-128 range bcrypt (and
// every other path here) is already implicitly built around.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

module.exports = { passwordSchema };
