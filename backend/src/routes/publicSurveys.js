const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { hashToken, isAcceptingAnswers, MAX_CHOICES } = require("../utils/surveys");
const { saveSurveyAnswers } = require("../utils/surveyResponses");

// #419: a partner answers a survey through their personal link, with no account. The link's token
// is the only credential: it is stored as a hash, expires, is bound to one survey and one partner,
// and answers the page only with that survey's own questions: no partner data. Every failure
// (unknown, expired, closed) answers the same way so a guess learns nothing.
const router = express.Router();
router.use(requireFeature("surveys"));
router.use(requireFeature("careTeam"));
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 120 }));

const NOT_AVAILABLE = {
  error: "This link isn't available. It may have expired or the survey may have closed.",
};

async function loadInvite(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const invite = await prisma.surveyInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { survey: { include: { questions: { orderBy: { position: "asc" } } } } },
  });
  if (!invite || invite.expiresAt <= new Date() || !isAcceptingAnswers(invite.survey)) return null;
  return invite;
}

// GET /api/public/surveys/:token -- the survey and whatever they have saved so far.
router.get("/:token", async (req, res, next) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json(NOT_AVAILABLE);
    const response = await prisma.surveyResponse.findUnique({
      where: { surveyId_partnerId: { surveyId: invite.surveyId, partnerId: invite.partnerId } },
      include: { answers: true },
    });
    if (!invite.openedAt) {
      await prisma.surveyInvite.update({ where: { id: invite.id }, data: { openedAt: new Date() } });
    }
    const church = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { churchName: true },
    });
    res.json({
      churchName: church?.churchName || null,
      title: invite.survey.title,
      intro: invite.survey.intro,
      submitted: Boolean(response?.submittedAt),
      questions: invite.survey.questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        label: q.label,
        choices: q.choices,
        allowOther: q.allowOther,
        required: q.required,
      })),
      answers: (response?.answers || [])
        .filter((a) => a.questionId)
        .map((a) => ({ questionId: a.questionId, value: a.value, values: a.values, other: a.other })),
    });
  } catch (err) {
    next(err);
  }
});

const bodySchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.string().max(6000).optional().nullable(),
        values: z.array(z.string().max(200)).max(MAX_CHOICES).optional(),
        other: z.string().max(300).optional().nullable(),
      })
    )
    .max(200),
});

// PUT /api/public/surveys/:token -- saves answers so far (finish later). POST .../submit sends
// them in. Either can be repeated until the survey closes.
async function save(req, res, next, submit) {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json(NOT_AVAILABLE);
    const { answers } = bodySchema.parse(req.body);
    const result = await saveSurveyAnswers({
      survey: invite.survey,
      partnerId: invite.partnerId,
      answers,
      submit,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ saved: true, submitted: Boolean(result.response.submittedAt) });
  } catch (err) {
    next(err);
  }
}
router.put("/:token", (req, res, next) => save(req, res, next, false));
router.post("/:token/submit", (req, res, next) => save(req, res, next, true));

module.exports = router;
