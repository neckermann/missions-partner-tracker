// Maps the one technical phrase inside a server validation error (Zod's own
// wording, formatted server-side by backend/src/middleware/errors.js's
// formatZodIssues as "path: message[; path: message][ (+N more)]") to
// something a non-technical admin can actually act on, without losing the
// field-path prefix that says which field is the problem.
//
// Deliberately narrow: this recognizes Zod v4's own fixed message strings
// (confirmed against a live Zod v4 install, not guessed) for the common
// cases -- a missing required field, a bad email/URL, a string/number out
// of range, a bad date, a bad enum choice -- and leaves anything it doesn't
// recognize exactly as the server sent it. A message this doesn't
// recognize is still useful (it names the field), just not reworded.
const PATTERNS = [
  [/^Invalid input: expected \w+, received (undefined|null)$/, () => "is required"],
  [/^Invalid email address$/, () => "must be a valid email address"],
  [/^Invalid URL$/, () => "must be a valid web address"],
  [
    /^Too small: expected string to have >=(\d+) characters?$/,
    (m) => `must be at least ${m[1]} character${m[1] === "1" ? "" : "s"}`,
  ],
  [
    /^Too big: expected string to have <=(\d+) characters?$/,
    (m) => `must be at most ${m[1]} character${m[1] === "1" ? "" : "s"}`,
  ],
  [/^Too small: expected number to be >=(\d+)$/, (m) => `must be at least ${m[1]}`],
  [/^Too big: expected number to be <=(\d+)$/, (m) => `must be at most ${m[1]}`],
  [/^Invalid input: expected date, received .+$/, () => "must be a valid date"],
  [/^Invalid option: expected one of (.+)$/, (m) => `must be one of: ${m[1].replace(/\|/g, ", ")}`],
  // Any other "expected X, received Y" type mismatch -- too many
  // (type, field) combinations to word individually, but "has an
  // invalid value" is still friendlier than the raw phrase.
  [/^Invalid input: expected \w+, received \w+$/, () => "has an invalid value"],
];

function mapOneIssue(message) {
  for (const [pattern, toFriendly] of PATTERNS) {
    const match = message.match(pattern);
    if (match) return toFriendly(match);
  }
  return null;
}

// Rewrites each "path: message" segment of a formatZodIssues()-style
// string, leaving the path and the "(+N more)" suffix untouched. Returns
// the input unchanged if it doesn't look like that format at all (a
// plain sentence, a Prisma-derived message, network-error text, etc.) --
// those are already in plain language.
export function mapServerErrorMessage(raw) {
  if (typeof raw !== "string" || !raw) return raw;

  const moreMatch = raw.match(/^(.*) \(\+(\d+) more\)$/);
  const body = moreMatch ? moreMatch[1] : raw;
  const suffix = moreMatch ? ` (+${moreMatch[2]} more)` : "";

  const segments = body.split("; ");
  let mappedAny = false;
  const rewritten = segments.map((segment) => {
    const colonIndex = segment.indexOf(": ");
    if (colonIndex === -1) return segment;
    const path = segment.slice(0, colonIndex);
    const message = segment.slice(colonIndex + 2);
    const friendly = mapOneIssue(message);
    if (!friendly) return segment;
    mappedAny = true;
    return `${path} ${friendly}`;
  });

  if (!mappedAny) return raw;
  return rewritten.join("; ") + suffix;
}
