// Maps Zod's fixed v4 message strings inside a server validation error (formatted by
// backend/src/middleware/errors.js formatZodIssues as "path: message[; ...][ (+N more)]") to
// wording an admin can act on, keeping the field path. Anything unrecognized is left as sent.
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
  // Any other "expected X, received Y" mismatch: too many combinations to word individually.
  [/^Invalid input: expected \w+, received \w+$/, () => "has an invalid value"],
];

function mapOneIssue(message) {
  for (const [pattern, toFriendly] of PATTERNS) {
    const match = message.match(pattern);
    if (match) return toFriendly(match);
  }
  return null;
}

// Rewrites each "path: message" segment, leaving the path and "(+N more)" untouched. Returns the
// input unchanged if it isn't that format (already plain language).
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
