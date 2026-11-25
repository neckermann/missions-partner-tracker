// Partner surveys (#419): the rules around questions, a partner's answers, and the personal
// link. The surveys themselves are church-built data; fixed here are the kinds of question and how
// each kind's answer is validated and stored (see SurveyAnswer in schema.prisma).
const { generateToken, hashToken } = require("./passwordSetup");
const { appBaseUrl } = require("./dispatchBlurbs");

const KINDS = [
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "text", label: "Free text" },
  { value: "yesno", label: "Yes / No" },
  { value: "photo", label: "Photo" },
];
const KIND_VALUES = KINDS.map((k) => k.value);
const CHOICE_KINDS = ["single", "multiple"];
const MAX_CHOICES = 20;
const MAX_TEXT = 5000;
const INVITE_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (v) => (typeof v === "string" ? v.trim() : "");

// Checks one answer against its question. Returns the columns to store ({ value, values, other }),
// { empty: true } when nothing was answered, or { error } when it doesn't fit the question.
function normalizeAnswer(question, raw) {
  const blank = { value: null, values: [], other: null };
  const other = clean(raw?.other).slice(0, 200) || null;
  if (question.kind === "text") {
    const value = clean(raw?.value).slice(0, MAX_TEXT) || null;
    return value ? { ...blank, value } : { empty: true };
  }
  if (question.kind === "yesno") {
    const value = clean(raw?.value);
    if (!value) return { empty: true };
    if (value !== "yes" && value !== "no") return { error: `"${question.label}" is a yes or no question` };
    return { ...blank, value };
  }
  if (other && !question.allowOther) return { error: `"${question.label}" doesn't take an "other" answer` };
  const allowed = question.choices || [];
  if (question.kind === "single") {
    const value = clean(raw?.value) || null;
    if (value && !allowed.includes(value)) {
      return { error: `"${value}" isn't one of the choices for "${question.label}"` };
    }
    if (value && other) return { error: `Pick a choice or write another, not both, for "${question.label}"` };
    return value || other ? { ...blank, value, other } : { empty: true };
  }
  const picked = [...new Set((Array.isArray(raw?.values) ? raw.values : []).map(clean).filter(Boolean))];
  const bad = picked.find((c) => !allowed.includes(c));
  if (bad) return { error: `"${bad}" isn't one of the choices for "${question.label}"` };
  return picked.length || other ? { ...blank, values: picked, other } : { empty: true };
}

// The questions marked required that have no answer in `answered` (a Set of question ids).
function missingRequired(questions, answered) {
  return questions.filter((q) => q.required && !answered.has(q.id));
}

// A survey link accepts answers only while the survey is open and not past its closing date.
function isAcceptingAnswers(survey, now = new Date()) {
  return survey.status === "open" && (!survey.closesAt || survey.closesAt > now);
}

function newInviteToken(now = new Date()) {
  const token = generateToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
  };
}

function buildSurveyUrl(token) {
  const base = appBaseUrl();
  return base ? `${base}/survey/${encodeURIComponent(token)}` : null;
}

// Who the app may email a link to: never a restricted partner, nobody we are told not to
// contact directly, and under "caution" only if email is one of the ticked ways. Staff can still
// record answers for them.
function emailBlockReason(partner) {
  if (partner.isRestricted) return "restricted";
  if (partner.contactLevel === "no_direct") return "not safe to contact directly";
  const channels = partner.contactChannels || [];
  if (partner.contactLevel === "caution" && channels.length > 0 && !channels.includes("email")) {
    return "not to be emailed";
  }
  return null;
}

// The address a link goes to: an organization's named contact, else the primary adult, else the
// first adult with an email.
function surveyEmailFor(partner, adults = []) {
  const ok = (e) => (e && /\S+@\S+\.\S+/.test(e) ? e.trim() : null);
  if (partner.kind === "organization") return ok(partner.contactEmail);
  const primary = adults.find((a) => a.isPrimaryContact && ok(a.email));
  const any = adults.find((a) => ok(a.email));
  return ok((primary || any)?.email);
}

module.exports = {
  KINDS,
  KIND_VALUES,
  CHOICE_KINDS,
  MAX_CHOICES,
  MAX_TEXT,
  INVITE_TTL_DAYS,
  normalizeAnswer,
  missingRequired,
  isAcceptingAnswers,
  newInviteToken,
  buildSurveyUrl,
  emailBlockReason,
  surveyEmailFor,
  hashToken,
};
