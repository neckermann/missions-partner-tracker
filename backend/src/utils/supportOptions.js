// Support preferences: the rules around the church's menu of options and a
// partner's answers. The menu is church-edited data (SupportOption rows); fixed
// here are the kinds of question and how each kind's answer is validated and shaped.
// (A starting list is an importable template pack: examples/template-packs/.)

const KINDS = [
  { value: "offer", label: "Something we offer (tick it if wanted)" },
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "text", label: "Free text" },
];
const KIND_VALUES = KINDS.map((k) => k.value);
const CHOICE_KINDS = ["single", "multiple"];

const MAX_CHOICES = 20;
const MAX_TEXT = 2000;

// How a partner's answer is stored in PartnerSupportPreference:
//   offer    -> only `selected`
//   single   -> `choice` or `other` (their own words)
//   multiple -> `choices` and/or `other`
//   text     -> `text`
// `selected` is also true when a question has an answer, so "who chose anything
// for this option" is one column for every kind.

const clean = (v) => (typeof v === "string" ? v.trim() : "");

// Checks a response against its option. Returns the columns to store ({ selected,
// choice, choices, other, text, note }), { empty: true } when there is nothing to
// keep, or { error } when it doesn't fit the option.
function normalizeResponse(option, raw) {
  const note = clean(raw?.note).slice(0, MAX_TEXT) || null;
  const blank = { choice: null, choices: [], other: null, text: null };
  const finish = (selected, columns) => {
    if (!selected && !note) return { empty: true };
    return { selected, ...blank, ...columns, note };
  };

  if (option.kind === "offer") return finish(raw?.selected === true, {});

  if (option.kind === "text") {
    const text = clean(raw?.text).slice(0, MAX_TEXT) || null;
    return finish(Boolean(text), { text });
  }

  const allowed = Array.isArray(option.choices) ? option.choices : [];
  const other = clean(raw?.other).slice(0, 200) || null;
  if (other && !option.allowOther) return { error: `"${option.label}" doesn't take an "other" answer` };

  if (option.kind === "single") {
    const choice = clean(raw?.choice) || null;
    if (choice && !allowed.includes(choice)) {
      return { error: `"${choice}" isn't one of the choices for "${option.label}"` };
    }
    if (choice && other) return { error: `Pick a choice or write another, not both, for "${option.label}"` };
    return finish(Boolean(choice || other), { choice, other });
  }

  const picked = [...new Set((Array.isArray(raw?.choices) ? raw.choices : []).map(clean).filter(Boolean))];
  const bad = picked.find((c) => !allowed.includes(c));
  if (bad) return { error: `"${bad}" isn't one of the choices for "${option.label}"` };
  return finish(picked.length > 0 || Boolean(other), { choices: picked, other });
}

// A readable one-line summary of a stored response, for lists and the report.
function describeAnswer(option, pref) {
  if (!pref) return "";
  if (option.kind === "offer") return pref.selected ? "Yes" : "";
  if (option.kind === "text") return pref.text || "";
  if (option.kind === "single") return pref.choice || pref.other || "";
  return [...(pref.choices || []), ...(pref.other ? [pref.other] : [])].join(", ");
}

module.exports = {
  KINDS,
  KIND_VALUES,
  CHOICE_KINDS,
  MAX_CHOICES,
  normalizeResponse,
  describeAnswer,
};
