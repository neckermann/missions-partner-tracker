// Saving a partner's answers to a survey: shared by the personal link (the partner) and the
// staff "fill in for this partner" route, so both apply the same rules.
const prisma = require("../prismaClient");
const { normalizeAnswer, missingRequired } = require("./surveys");

// answers: [{ questionId, value, values, other }]. Answers for questions not mentioned are left
// alone; an empty answer removes that question's stored answer. `submit` also checks required
// questions. enteredBy is { id, name } for staff, or null when the partner answers.
// Returns { response } or { error }.
async function saveSurveyAnswers({ survey, partnerId, answers, submit = false, enteredBy = null }) {
  const questions = await prisma.surveyQuestion.findMany({
    where: { surveyId: survey.id },
    orderBy: { position: "asc" },
  });
  const byId = new Map(questions.map((q) => [q.id, q]));

  const toSave = [];
  const toClear = [];
  for (const item of answers) {
    const question = byId.get(item.questionId);
    if (!question) return { error: "That question isn't part of this survey" };
    const result = normalizeAnswer(question, item);
    if (result.error) return { error: result.error };
    if (result.empty) toClear.push(question.id);
    else toSave.push({ question, ...result });
  }

  const existing = await prisma.surveyResponse.findUnique({
    where: { surveyId_partnerId: { surveyId: survey.id, partnerId } },
    include: { answers: { select: { questionId: true } } },
  });
  const answered = new Set((existing?.answers || []).map((a) => a.questionId).filter(Boolean));
  toClear.forEach((id) => answered.delete(id));
  toSave.forEach((a) => answered.add(a.question.id));
  if (submit) {
    const missing = missingRequired(questions, answered);
    if (missing.length) return { error: `Please answer: ${missing.map((q) => q.label).join("; ")}` };
  }

  const response = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.surveyResponse.update({
          where: { id: existing.id },
          data: {
            ...(submit ? { submittedAt: existing.submittedAt || new Date() } : {}),
            ...(enteredBy ? { enteredById: enteredBy.id, enteredByName: enteredBy.name } : {}),
          },
        })
      : await tx.surveyResponse.create({
          data: {
            surveyId: survey.id,
            partnerId,
            submittedAt: submit ? new Date() : null,
            enteredById: enteredBy?.id || null,
            enteredByName: enteredBy?.name || null,
          },
        });
    if (toClear.length) {
      await tx.surveyAnswer.deleteMany({ where: { responseId: row.id, questionId: { in: toClear } } });
    }
    for (const { question, value, values, other } of toSave) {
      const data = {
        position: question.position,
        label: question.label,
        kind: question.kind,
        value,
        values,
        other,
      };
      const found = await tx.surveyAnswer.findFirst({
        where: { responseId: row.id, questionId: question.id },
        select: { id: true },
      });
      if (found) await tx.surveyAnswer.update({ where: { id: found.id }, data });
      else await tx.surveyAnswer.create({ data: { responseId: row.id, questionId: question.id, ...data } });
    }
    return row;
  });
  return { response };
}

module.exports = { saveSurveyAnswers };
