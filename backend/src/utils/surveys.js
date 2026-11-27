// Partner surveys (#419): the rules around questions, a partner's answers, and the personal
// link. The surveys themselves are church-built data; fixed here are the kinds of question and how
// each kind's answer is validated and stored (see SurveyAnswer in schema.prisma).
const { generateToken, hashToken } = require("./passwordSetup");
const { appBaseUrl } = require("./dispatchBlurbs");
const { emailBlockReason, surveyEmailFor } = require("./contactReach");
const { fieldFitsKind, PHOTO, normalizeAddress, presentation } = require("./surveyFields");
const { normalizeSupportAnswer, FIELD: SUPPORT_FIELD, KIND: SUPPORT_KIND } = require("./surveySupport");

const KINDS = [
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "text", label: "Free text" },
  { value: "yesno", label: "Yes / No" },
  { value: "photo", label: "Photo" },
  { value: "address", label: "Mailing address" },
  { value: "support", label: "Support preferences (the church's menu)" },
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
  if (question.kind === SUPPORT_KIND) {
    // `question.supportMenu` is the church's menu, loaded by the caller (utils/surveyResponses.js).
    const result = normalizeSupportAnswer(question.supportMenu, raw?.value);
    if (result.error) return { error: `${result.error} ("${question.label}")` };
    return result.value ? { ...blank, value: result.value } : { empty: true };
  }
  if (question.kind === "address") {
    // Stored as one canonical JSON line in `value` (see normalizeAddress), so it compares and moves
    // through the proposal flow like any other text answer.
    const result = normalizeAddress(raw?.value);
    if (result.error) return { error: `${result.error} ("${question.label}")` };
    return result.value ? { ...blank, value: result.value } : { empty: true };
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

// Checks a question's choices and its link to the partner's record, and returns the columns to
// store ({ choices, allowOther, field }) or { error }. Shared by the builder and pack import.
function shapeQuestion(q) {
  const isChoice = CHOICE_KINDS.includes(q.kind);
  const fixed = q.field ? presentation(q.field) : {};
  const choices = fixed.choices ? fixed.choices : isChoice ? [...new Set(q.choices || [])] : [];
  const allowOther = fixed.choices ? false : isChoice ? q.allowOther === true : false;
  if (isChoice && choices.length === 0 && !allowOther) {
    return { error: `"${q.label}" needs at least one choice, or an “other” box` };
  }
  const field = q.kind === "photo" ? PHOTO : q.kind === SUPPORT_KIND ? SUPPORT_FIELD : q.field || null;
  if (field && !fieldFitsKind(field, q.kind)) {
    return { error: `"${q.label}" can't be linked to that part of the record` };
  }
  return { choices, allowOther, field };
}

module.exports = {
  shapeQuestion,
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
