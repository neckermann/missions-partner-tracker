// One rule for phone numbers and email addresses, used by every place that saves one (#548): the
// partner and adult forms, trips, the survey, accounts. A phone is saved in international form
// ("+15065550259"); the person typing may leave the country code off, and then the church's own
// country is assumed (the United States until a church sets another). The check is deliberately
// lenient: it refuses junk and numbers of the wrong length, but it does not ask whether the number
// really exists, so fictional 555 numbers on a demo still save.
const { parsePhoneNumberFromString } = require("libphonenumber-js/min");

const DEFAULT_PHONE_COUNTRY = "US";
const PHONE_PROBLEM =
  "That doesn't look like a phone number. Include the area code, or start with + and the country code.";
const EMAIL_PROBLEM = "That doesn't look like an email address";
const MAX_PHONE_INPUT = 40;
const MAX_EMAIL = 200;

const text = (raw) => (typeof raw === "string" ? raw.trim() : "");

// { value } (the E.164 number, or null when blank) or { error }.
function normalizePhone(raw, country = DEFAULT_PHONE_COUNTRY) {
  const input = text(raw);
  if (!input) return { value: null };
  if (input.length > MAX_PHONE_INPUT) return { error: PHONE_PROBLEM };
  // Letters are never part of a number we can dial ("dsafdsfsadf"); an "ext" is not supported here.
  if (/[a-z]/i.test(input)) return { error: PHONE_PROBLEM };
  const parsed = parsePhoneNumberFromString(input, country);
  if (!parsed || !parsed.isPossible()) return { error: PHONE_PROBLEM };
  return { value: parsed.number };
}

// { value } (trimmed, lower case, or null when blank) or { error }.
function normalizeEmail(raw) {
  const input = text(raw);
  if (!input) return { value: null };
  if (input.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return { error: EMAIL_PROBLEM };
  return { value: input.toLowerCase() };
}

// The same checks as zod pieces: blank becomes null, anything else must pass and is saved in its
// normalised form. `issue` is the message the form shows.
function zodWith(z, normalize) {
  return z
    .string()
    .optional()
    .nullable()
    .transform((raw, ctx) => {
      const result = normalize(raw);
      if (result.error) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.value;
    });
}
const phoneSchema = (z, country) => zodWith(z, (raw) => normalizePhone(raw, country));
const emailSchema = (z) => zodWith(z, normalizeEmail);

module.exports = {
  DEFAULT_PHONE_COUNTRY,
  PHONE_PROBLEM,
  EMAIL_PROBLEM,
  normalizePhone,
  normalizeEmail,
  phoneSchema,
  emailSchema,
};
