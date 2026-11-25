// The ILR (Interagency Language Roundtable) scale, standard in missions field-language assessment.
// Keys match backend/src/routes/proficiencyLevels.js PROFICIENCY_LEVELS exactly.
export const PROFICIENCY_LEVELS = [
  { value: "0", label: "0 — No Proficiency" },
  { value: "0+", label: "0+ — Memorized Proficiency" },
  { value: "1", label: "1 — Elementary Proficiency" },
  { value: "1+", label: "1+ — Elementary Proficiency, Plus" },
  { value: "2", label: "2 — Limited Working Proficiency" },
  { value: "2+", label: "2+ — Limited Working Proficiency, Plus" },
  { value: "3", label: "3 — General Professional Proficiency" },
  { value: "3+", label: "3+ — General Professional Proficiency, Plus" },
  { value: "4", label: "4 — Advanced Professional Proficiency" },
  { value: "4+", label: "4+ — Advanced Professional Proficiency, Plus" },
  { value: "5", label: "5 — Native or Bilingual Proficiency" },
];

const LABEL_BY_VALUE = Object.fromEntries(PROFICIENCY_LEVELS.map((p) => [p.value, p.label]));

export function proficiencyLabel(value) {
  return LABEL_BY_VALUE[value] || value;
}
