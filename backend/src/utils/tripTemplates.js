// The lists an admin edits as whole ordered lists (a trip's application questions,
// the church-wide ones and their library, the requirement checklist and its library)
// are real rows (ApplicationQuestion, RequirementTemplateItem). The API still speaks
// ordered arrays (`[{ id, label, ... }]`), so these helpers are the one place that
// converts arrays to rows and back, and application answers to the `responses` map the public form posts.
const crypto = require("crypto");
const prisma = require("../prismaClient");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUESTION_ORDER = { orderBy: { position: "asc" } };

const toQuestion = (r) => ({
  id: r.id,
  label: r.label,
  required: r.required,
  type: r.type,
  ...(r.options.length ? { options: r.options } : {}),
});

async function loadQuestions(scope, tripId = null, db = prisma) {
  const rows = await db.applicationQuestion.findMany({ where: { scope, tripId }, ...QUESTION_ORDER });
  return rows.map(toQuestion);
}

// Makes the stored list equal to `items`, in order. An item keeps its row when its
// id is already in the list; a new item keeps its id if it is an unused UUID, else
// gets a fresh one (so a copied entry never collides). Returns the saved list.
async function replaceQuestions(db, scope, tripId, items) {
  const where = { scope, tripId };
  const existing = new Set(
    (await db.applicationQuestion.findMany({ where, select: { id: true } })).map((r) => r.id)
  );
  const claimed = new Set(
    (
      await db.applicationQuestion.findMany({
        where: { id: { in: items.map((i) => i.id) } },
        select: { id: true },
      })
    ).map((r) => r.id)
  );
  const used = new Set();
  const plan = items.map((item, position) => {
    let id = item.id;
    const mine = existing.has(id);
    if (used.has(id) || (!mine && (claimed.has(id) || !UUID.test(id)))) id = crypto.randomUUID();
    used.add(id);
    return {
      id,
      isNew: !existing.has(id),
      data: {
        position,
        label: item.label,
        required: item.required === true,
        type: item.type || "text",
        options: ["select", "checkboxes"].includes(item.type) ? item.options || [] : [],
      },
    };
  });
  const keep = new Set(plan.map((p) => p.id));
  const gone = [...existing].filter((id) => !keep.has(id));
  if (gone.length) await db.applicationQuestion.deleteMany({ where: { id: { in: gone } } });
  for (const p of plan) {
    if (p.isNew) await db.applicationQuestion.create({ data: { id: p.id, scope, tripId, ...p.data } });
    else await db.applicationQuestion.update({ where: { id: p.id }, data: p.data });
  }
  return loadQuestions(scope, tripId, db);
}

// The questions an applicant is asked: the church-wide ones first, then the trip's own.
async function loadApplicantQuestions(tripId, db = prisma) {
  return [...(await loadQuestions("template", null, db)), ...(await loadQuestions("trip", tripId, db))];
}

// A trip's questions copied onto another trip (a cloned trip).
async function copyTripQuestions(db, fromTripId, toTripId) {
  const rows = await db.applicationQuestion.findMany({
    where: { scope: "trip", tripId: fromTripId },
    ...QUESTION_ORDER,
  });
  if (!rows.length) return;
  await db.applicationQuestion.createMany({
    data: rows.map((r) => ({
      scope: "trip",
      tripId: toTripId,
      position: r.position,
      label: r.label,
      required: r.required,
      type: r.type,
      options: r.options,
    })),
  });
}

// Turns the public form's `{ questionId: "text" | ["a", "b"] }` into answer rows for
// the questions really asked of this trip; unknown keys are ignored.
function answerRows(questions, responses) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows = [];
  for (const [questionId, answer] of Object.entries(responses || {})) {
    const q = byId.get(questionId);
    if (!q) continue;
    const isList = Array.isArray(answer);
    rows.push({
      questionId,
      label: q.label,
      value: isList ? null : String(answer),
      values: isList ? answer.map(String) : [],
    });
  }
  const order = new Map(questions.map((q, i) => [q.id, i]));
  rows.sort((a, b) => order.get(a.questionId) - order.get(b.questionId));
  return rows.map((r, position) => ({ ...r, position }));
}

const ANSWERS_INCLUDE = { orderBy: { position: "asc" } };

// An answer as the API shows it: its question (if it still exists), the wording it was asked with, and the answer as text or a list.
const toAnswer = (a) => ({ questionId: a.questionId, label: a.label, value: a.value, values: a.values });

const toRequirement = (r) => ({
  id: r.id,
  label: r.label,
  kind: r.kind,
  bodyText: r.bodyText,
  reminderLeadDays: r.reminderLeadDays,
  minorsOnly: r.minorsOnly,
});

async function loadRequirementItems(scope, db = prisma) {
  const rows = await db.requirementTemplateItem.findMany({ where: { scope }, orderBy: { position: "asc" } });
  return rows.map(toRequirement);
}

async function replaceRequirementItems(db, scope, items) {
  const existing = new Set(
    (await db.requirementTemplateItem.findMany({ where: { scope }, select: { id: true } })).map((r) => r.id)
  );
  const claimed = new Set(
    (
      await db.requirementTemplateItem.findMany({
        where: { id: { in: items.map((i) => i.id) } },
        select: { id: true },
      })
    ).map((r) => r.id)
  );
  const used = new Set();
  const plan = items.map((item, position) => {
    let id = item.id;
    const mine = existing.has(id);
    if (used.has(id) || (!mine && (claimed.has(id) || !UUID.test(id)))) id = crypto.randomUUID();
    used.add(id);
    return {
      id,
      isNew: !existing.has(id),
      data: {
        position,
        label: item.label,
        kind: item.kind || "document",
        bodyText: item.bodyText || null,
        reminderLeadDays: item.reminderLeadDays || null,
        minorsOnly: item.minorsOnly === true,
      },
    };
  });
  const keep = new Set(plan.map((p) => p.id));
  const gone = [...existing].filter((id) => !keep.has(id));
  if (gone.length) await db.requirementTemplateItem.deleteMany({ where: { id: { in: gone } } });
  for (const p of plan) {
    if (p.isNew) await db.requirementTemplateItem.create({ data: { id: p.id, scope, ...p.data } });
    else await db.requirementTemplateItem.update({ where: { id: p.id }, data: p.data });
  }
  return loadRequirementItems(scope, db);
}

async function loadChurchLists(db = prisma) {
  const [tripApplicationTemplate, tripQuestionLibrary, tripRequirementTemplate, tripRequirementLibrary] =
    await Promise.all([
      loadQuestions("template", null, db),
      loadQuestions("library", null, db),
      loadRequirementItems("template", db),
      loadRequirementItems("library", db),
    ]);
  return { tripApplicationTemplate, tripQuestionLibrary, tripRequirementTemplate, tripRequirementLibrary };
}

module.exports = {
  QUESTION_ORDER,
  ANSWERS_INCLUDE,
  loadQuestions,
  replaceQuestions,
  loadApplicantQuestions,
  copyTripQuestions,
  answerRows,
  toAnswer,
  loadRequirementItems,
  replaceRequirementItems,
  loadChurchLists,
};
