// Support preferences: the rules around the church's menu of options and a
// partner's answers. The menu is church-edited data (SupportOption rows); fixed
// here are the kinds of question, how each kind's answer is validated and shaped,
// and an example set a church can add and then edit or delete.
const prisma = require("../prismaClient");

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

// An example set a church can add from an empty catalog, then edit, reorder or delete.
const EXAMPLE_OPTIONS = [
  { group: "Logistics", label: "Help finding a place to stay while you are home" },
  { group: "Logistics", label: "Help with transportation while you are home" },
  { group: "Logistics", label: "Travel arrangements" },
  { group: "Logistics", label: "Airport pick-up" },

  { group: "Representing you", label: "Speak about you at a church gathering from time to time" },
  { group: "Representing you", label: "Host a prayer or information evening while you are home" },
  { group: "Representing you", label: "A display table with photos and what you are doing" },
  { group: "Representing you", label: "People here who know your journey well" },

  { group: "Communication and encouragement", label: "A safe, confidential person to be honest with" },
  { group: "Communication and encouragement", label: "Personal letters, cards or mail" },
  { group: "Communication and encouragement", label: "Visits from teams" },
  {
    group: "Communication and encouragement",
    label: "What can and cannot be shared with others?",
    kind: "text",
    staffOnly: true,
  },

  { group: "Prayer", label: "Individual prayer" },
  { group: "Prayer", label: "Group prayer" },
  { group: "Prayer", label: "Prayer by video call from time to time" },

  { group: "Gifts", label: "Care packages" },
  { group: "Gifts", label: "Money for special occasions such as birthdays and holidays" },
  {
    group: "Gifts",
    label: "How should special financial gifts be sent?",
    kind: "single",
    choices: ["Bank transfer", "A transfer app", "Through an organization"],
    allowOther: true,
  },
];

// Adds the example set when the catalog is empty; returns how many (0 if the church has options, so it never overwrites).
async function addExampleOptions(db = prisma) {
  if ((await db.supportOption.count()) > 0) return 0;
  const orderIn = new Map();
  const rows = EXAMPLE_OPTIONS.map((o) => {
    const n = (orderIn.get(o.group) || 0) + 1;
    orderIn.set(o.group, n);
    return {
      group: o.group,
      label: o.label,
      kind: o.kind || "offer",
      choices: o.choices || [],
      allowOther: o.allowOther || false,
      staffOnly: o.staffOnly === true,
      sortOrder: n,
    };
  });
  await db.supportOption.createMany({ data: rows });
  return rows.length;
}

module.exports = {
  KINDS,
  KIND_VALUES,
  CHOICE_KINDS,
  MAX_CHOICES,
  EXAMPLE_OPTIONS,
  normalizeResponse,
  describeAnswer,
  addExampleOptions,
};
