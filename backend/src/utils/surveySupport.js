// The "support preferences" survey question (#419 + #374): a partner answers the church's menu of
// ways it supports them, through their own link. The answer is one canonical JSON map of
// { [optionId]: { selected, choice, choices, other, text } }, only the options they answered, kept
// in the answer's `value`. It never edits their record by itself: it becomes a proposed change a
// person approves on Survey updates (utils/surveyProposals.js), which then writes the same
// PartnerSupportPreference rows the partner page edits.
const prisma = require("../prismaClient");
const { normalizeResponse, describeAnswer } = require("./supportOptions");

const FIELD = "supportPreferences";
const KIND = "support";
const clean = (v) => (typeof v === "string" ? v.trim() : "");

// The menu a partner sees: active options that are not staff-only. [{ id, group, label, kind,
// choices, allowOther }] in menu order.
async function loadMenuForPartner(db = prisma) {
  const options = await db.supportOption.findMany({
    where: { active: true, staffOnly: false },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return options.map((o) => ({
    id: o.id,
    group: o.group,
    label: o.label,
    kind: o.kind,
    choices: o.choices,
    allowOther: o.allowOther,
  }));
}

// The response columns that matter for a comparison or a write, without the note.
const pick = (r) => ({
  ...(r.selected ? { selected: true } : {}),
  ...(r.choice ? { choice: r.choice } : {}),
  ...(r.choices?.length ? { choices: [...r.choices].sort() } : {}),
  ...(r.other ? { other: r.other } : {}),
  ...(r.text ? { text: r.text } : {}),
});

const stringify = (map) => {
  const ids = Object.keys(map).sort();
  return ids.length ? JSON.stringify(Object.fromEntries(ids.map((id) => [id, map[id]]))) : "";
};

// Checks an answer against the menu. Returns { value } (canonical JSON, or null when nothing was
// answered) or { error }.
function normalizeSupportAnswer(menu, raw) {
  const text = clean(raw);
  if (!text) return { value: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That answer isn't in a form we can read" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "That answer isn't in a form we can read" };
  }
  const byId = new Map((menu || []).map((o) => [o.id, o]));
  const out = {};
  for (const [optionId, item] of Object.entries(parsed)) {
    const option = byId.get(optionId);
    if (!option) return { error: "One of those options isn't offered any more" };
    const result = normalizeResponse(option, item || {});
    if (result.error) return { error: result.error };
    if (result.empty) continue;
    const kept = pick(result);
    if (Object.keys(kept).length) out[optionId] = kept;
  }
  return { value: stringify(out) || null };
}

// What would change on the partner's record: the answered options whose stored answer differs.
// Returns { current, proposed } as canonical JSON of just those options ("" when nothing differs).
async function diffAgainstRecord(db, partnerId, proposedJson) {
  let proposed;
  try {
    proposed = JSON.parse(proposedJson || "{}");
  } catch {
    return { current: "", proposed: "" };
  }
  const ids = Object.keys(proposed);
  if (!ids.length) return { current: "", proposed: "" };
  const stored = await db.partnerSupportPreference.findMany({
    where: { partnerId, optionId: { in: ids } },
  });
  const have = new Map(stored.map((p) => [p.optionId, pick(p)]));
  const changedNow = {};
  const changedNew = {};
  for (const id of ids) {
    const before = have.get(id) || {};
    if (JSON.stringify(before) === JSON.stringify(proposed[id])) continue;
    if (Object.keys(before).length) changedNow[id] = before;
    changedNew[id] = proposed[id];
  }
  return { current: stringify(changedNow), proposed: stringify(changedNew) };
}

// Writes an approved value into the partner's support preferences. Options not in it are left
// alone, and a staff note already on a row is kept. Returns { error } or nothing.
async function applySupportAnswer(tx, partnerId, value) {
  const settings = await tx.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const { isFeatureEnabled } = require("./features");
  if (
    !isFeatureEnabled(settings?.enabledFeatures, "supportPreferences") ||
    !isFeatureEnabled(settings?.enabledFeatures, "careTeam")
  ) {
    return { error: "Support preferences is turned off" };
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "That isn't a value we can apply" };
  }
  const ids = Object.keys(parsed || {});
  if (!ids.length) return { error: "There is nothing to apply" };
  const options = await tx.supportOption.findMany({ where: { id: { in: ids } } });
  const byId = new Map(options.map((o) => [o.id, o]));
  for (const id of ids) {
    const option = byId.get(id);
    if (!option || option.staffOnly || !option.active) {
      return { error: "One of those options isn't offered any more" };
    }
    const result = normalizeResponse(option, parsed[id]);
    if (result.error) return { error: result.error };
    if (result.empty) continue;
    const { note, ...columns } = result; // eslint-disable-line no-unused-vars
    await tx.partnerSupportPreference.upsert({
      where: { partnerId_optionId: { partnerId, optionId: id } },
      create: { partnerId, optionId: id, ...columns },
      update: columns,
    });
  }
}

// A readable description of a stored map, one line per option: "Group: Label: answer".
async function describeSupportValue(db, value) {
  let parsed;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    return "";
  }
  const ids = Object.keys(parsed || {});
  if (!ids.length) return "";
  const options = await db.supportOption.findMany({ where: { id: { in: ids } } });
  const byId = new Map(options.map((o) => [o.id, o]));
  return ids
    .map((id) => {
      const o = byId.get(id);
      if (!o) return null;
      const a = describeAnswer(o, parsed[id]);
      return `${o.group}: ${o.label}${a && a !== "Yes" ? `: ${a}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  FIELD,
  KIND,
  loadMenuForPartner,
  normalizeSupportAnswer,
  diffAgainstRecord,
  applySupportAnswer,
  describeSupportValue,
};
