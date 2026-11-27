// Saving a partner's answers to a survey: shared by the personal link (the partner) and the
// staff "fill in for this partner" route, so both apply the same rules.
const prisma = require("../prismaClient");
const heicConvert = require("heic-convert");
const { matchesFileSignature } = require("./fileSignature");
const { normalizeAnswer, missingRequired } = require("./surveys");
const { proposeFromResponse } = require("./surveyProposals");
const { loadMenuForPartner, KIND: SUPPORT_KIND } = require("./surveySupport");
const { FIELDS, presentQuestion } = require("./surveyFields");

// answers: [{ questionId, value, values, other }]. Answers for questions not mentioned are left
// alone; an empty answer removes that question's stored answer. `submit` also checks required
// questions. enteredBy is { id, name } for staff, or null when the partner answers.
// Returns { response } or { error }.
async function saveSurveyAnswers({ survey, partnerId, answers, submit = false, enteredBy = null }) {
  const questions = await prisma.surveyQuestion.findMany({
    where: { surveyId: survey.id },
    orderBy: { position: "asc" },
  });
  const supportMenu = questions.some((q) => q.kind === SUPPORT_KIND) ? await loadMenuForPartner() : null;
  const byId = new Map(questions.map((q) => [q.id, q]));

  const toSave = [];
  const toClear = [];
  for (const item of answers) {
    const question = byId.get(item.questionId);
    if (!question) return { error: "That question isn't part of this survey" };
    if (question.kind === "photo") continue; // answered by uploading, see saveSurveyPhoto
    const shown = presentQuestion(question);
    const result = normalizeAnswer(supportMenu ? { ...shown, supportMenu } : shown, item);
    if (result.error) return { error: result.error };
    // A question linked to a field of the partner's record takes only a value that field accepts
    // (a phone number that is one, an email that is one) and keeps it in the one saved form, so
    // what staff review later is never junk and reads the same as what is on file.
    const linked = question.field && FIELDS[question.field];
    if (linked?.normalize && !result.empty) {
      const typed = result.value || result.other;
      const checked = linked.normalize(typed);
      if (checked.error) return { error: `${question.label}: ${checked.error}` };
      if (checked.value && question.kind === "text") result.value = checked.value;
    }
    if (result.empty) toClear.push(question.id);
    else toSave.push({ question, ...result });
  }

  const existing = await prisma.surveyResponse.findUnique({
    where: { surveyId_partnerId: { surveyId: survey.id, partnerId } },
    include: { answers: { select: { questionId: true } } },
  });
  const uploads = existing
    ? await prisma.surveyUpload.findMany({ where: { responseId: existing.id }, select: { questionId: true } })
    : [];
  const answered = new Set((existing?.answers || []).map((a) => a.questionId).filter(Boolean));
  uploads.forEach((u) => u.questionId && answered.add(u.questionId));
  toClear.forEach((id) => answered.delete(id));
  toSave.forEach((a) => answered.add(a.question.id));
  if (submit) {
    // Staff can't upload a photo for a partner here, so a required photo doesn't block their entry.
    const missing = missingRequired(
      questions.filter((q) => !(enteredBy && q.kind === "photo")),
      answered
    );
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
  if (response.submittedAt && submit) await proposeFromResponse(response.id);
  return { response };
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
// The browser shrinks a photo before sending it (frontend/src/utils/prepareImage.js), so this is the safety net.
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

// Stores a photo sent for a photo question (replacing an earlier one for it) and records it as the
// answer. The type and the file's real signature are both checked; HEIC is stored as JPEG, which
// every browser can show. Returns { response } or { error }.
async function saveSurveyPhoto({ survey, partnerId, questionId, contentType, buffer }) {
  const question = await prisma.surveyQuestion.findFirst({
    where: { id: questionId, surveyId: survey.id, kind: "photo" },
  });
  if (!question) return { error: "That isn't a photo question" };
  if (!PHOTO_TYPES.includes(contentType)) return { error: "Please choose a JPEG, PNG, WebP or HEIC photo" };
  if (!buffer?.length || buffer.length > MAX_PHOTO_BYTES)
    return { error: "Please choose a photo under 15 MB" };
  const isHeic = contentType === "image/heic" || contentType === "image/heif";
  if (!matchesFileSignature(buffer, contentType)) {
    return { error: "That file doesn't look like the kind of photo it says it is" };
  }
  let bytes = buffer;
  let storedType = contentType;
  if (isHeic) {
    try {
      bytes = Buffer.from(await heicConvert({ buffer, format: "JPEG", quality: 0.9 }));
    } catch {
      return { error: "We couldn't read that photo. Please try a JPEG or PNG." };
    }
    storedType = "image/jpeg";
  }

  const response = await prisma.$transaction(async (tx) => {
    const row =
      (await tx.surveyResponse.findUnique({
        where: { surveyId_partnerId: { surveyId: survey.id, partnerId } },
      })) || (await tx.surveyResponse.create({ data: { surveyId: survey.id, partnerId } }));
    const old = await tx.surveyUpload.findMany({ where: { responseId: row.id, questionId } });
    if (old.length) {
      await tx.surveyProposal.deleteMany({
        where: { uploadId: { in: old.map((o) => o.id) }, status: "pending" },
      });
      await tx.surveyUpload.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    await tx.surveyUpload.create({
      data: {
        responseId: row.id,
        partnerId,
        questionId,
        contentType: storedType,
        fileSize: bytes.length,
        bytes,
      },
    });
    const data = {
      position: question.position,
      label: question.label,
      kind: "photo",
      value: "Photo sent",
      values: [],
      other: null,
    };
    const found = await tx.surveyAnswer.findFirst({
      where: { responseId: row.id, questionId },
      select: { id: true },
    });
    if (found) await tx.surveyAnswer.update({ where: { id: found.id }, data });
    else await tx.surveyAnswer.create({ data: { responseId: row.id, questionId, ...data } });
    return row;
  });
  return { response };
}

module.exports = { saveSurveyAnswers, saveSurveyPhoto, PHOTO_TYPES, MAX_PHOTO_BYTES };
