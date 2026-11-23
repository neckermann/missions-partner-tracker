// Small zod building blocks shared by every report's parameters, so a date
// or a checkbox means the same thing and fails the same way everywhere.
// An empty string from a form field is treated as "not provided."
const { z } = require("zod");

const blankToUndefined = (v) => (v === "" || v === null ? undefined : v);

// YYYY-MM-DD in, Date at UTC midnight out (the shape Prisma uses for dates).
const optionalDay = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), "Not a real date")
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .optional()
);

// Checkbox: true/false or the strings a query string carries.
const flag = (defaultValue = false) =>
  z.preprocess(
    blankToUndefined,
    z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(defaultValue)
  );

const oneOf = (values, defaultValue) => z.preprocess(blankToUndefined, z.enum(values).default(defaultValue));

const positiveInt = (defaultValue, max = 3650) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(max).default(defaultValue));

// Date -> "YYYY-MM-DD" (or null). Report rows carry calendar days as plain
// strings so JSON, CSV and the table all agree and nothing shifts with a
// timezone.
function ymd(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

const KIND_VALUES = ["all", "missionary", "organization"];

module.exports = { optionalDay, flag, oneOf, positiveInt, ymd, KIND_VALUES };
