// Turning survey answers into proposed changes to a partner's record (#419). Nothing is written to
// the record here: a proposal waits on the Survey updates page for a person to approve, edit or
// reject it (see routes/surveyUpdates.js and utils/surveyFields.js).
const prisma = require("../prismaClient");
const { FIELDS, PHOTO, loadContext, currentText, sameValue } = require("./surveyFields");
const { diffAgainstRecord } = require("./surveySupport");

const clean = (v) => (typeof v === "string" ? v.trim() : "");

// The text a partner gave for a text or single-choice question.
function answerText(answer) {
  return clean(answer?.value) || clean(answer?.other);
}

// Re-computes the pending proposals for one submitted response. Earlier pending ones are replaced
// (the partner changed their mind), decided ones stay. An answer that already matches the record,
// or one whose exact value was already decided for this response, proposes nothing.
async function proposeFromResponse(responseId) {
  const response = await prisma.surveyResponse.findUnique({
    where: { id: responseId },
    include: {
      answers: true,
      uploads: true,
      survey: { include: { questions: { where: { field: { not: null } } } } },
    },
  });
  if (!response || !response.submittedAt) return 0;
  const linked = response.survey.questions.filter((q) => FIELDS[q.field]);
  await prisma.surveyProposal.deleteMany({ where: { responseId, status: "pending" } });
  if (!linked.length) return 0;

  const ctx = await loadContext(prisma, response.partnerId);
  if (!ctx) return 0;
  const decided = await prisma.surveyProposal.findMany({ where: { responseId, status: { not: "pending" } } });
  let created = 0;
  for (const q of linked) {
    const base = {
      surveyId: response.surveyId,
      responseId,
      partnerId: response.partnerId,
      questionId: q.id,
      field: q.field,
      fieldLabel: FIELDS[q.field].label,
    };
    if (q.field === PHOTO) {
      const upload = response.uploads.find((u) => u.questionId === q.id);
      if (!upload || decided.some((d) => d.uploadId === upload.id)) continue;
      await prisma.surveyProposal.create({ data: { ...base, uploadId: upload.id } });
      created += 1;
      continue;
    }
    let proposed = answerText(response.answers.find((a) => a.questionId === q.id));
    if (!proposed) continue;
    let current = currentText(ctx, q.field);
    if (FIELDS[q.field].support) {
      // Only the options whose answer differs from what is on file, so approving changes just those.
      const diff = await diffAgainstRecord(prisma, response.partnerId, proposed);
      proposed = diff.proposed;
      current = diff.current;
      if (!proposed) continue;
    }
    if (sameValue(current, proposed)) continue;
    if (decided.some((d) => d.questionId === q.id && sameValue(d.proposedValue, proposed))) continue;
    await prisma.surveyProposal.create({
      data: { ...base, currentValue: current || null, proposedValue: proposed },
    });
    created += 1;
  }
  return created;
}

module.exports = { proposeFromResponse };
