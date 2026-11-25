// A partner's answer to the support-preferences survey question: one JSON map of
// { [optionId]: { selected, choice, choices, other, text } }, only the options they answered (the
// server keeps the same shape, utils/surveySupport.js).
export function parseSupportAnswer(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const isEmpty = (a) =>
  !a || (!a.selected && !a.choice && !(a.choices && a.choices.length) && !a.other && !a.text);

// The map with one option's answer changed, as the JSON line to store ("" when nothing is answered).
export function setSupportAnswer(map, optionId, patch) {
  const next = { ...map, [optionId]: { ...(map[optionId] || {}), ...patch } };
  if (isEmpty(next[optionId])) delete next[optionId];
  return Object.keys(next).length ? JSON.stringify(next) : "";
}

// One answer in words: "Yes" for a ticked offer, the choices, or what they wrote.
export function describeOptionAnswer(a) {
  if (!a) return "";
  return [a.choice, ...(a.choices || []), a.other, a.text].filter(Boolean).join(", ");
}

// A saved answer as one line: "A visit; Best days: Mon, Tue".
export function describeSupportAnswer(value, menu = []) {
  const map = parseSupportAnswer(value);
  const byId = new Map(menu.map((o) => [o.id, o]));
  return Object.entries(map)
    .map(([id, a]) => {
      const o = byId.get(id);
      if (!o) return null;
      const words = describeOptionAnswer(a);
      return words ? `${o.label}: ${words}` : o.label;
    })
    .filter(Boolean)
    .join("; ");
}

// The menu grouped for display: [[group, [option...]], ...] in the order given.
export function groupMenu(menu = []) {
  const groups = new Map();
  for (const o of menu) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group).push(o);
  }
  return [...groups.entries()];
}
