const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { hashToken, isAcceptingAnswers, MAX_CHOICES } = require("../utils/surveys");
const { saveSurveyAnswers, saveSurveyPhoto } = require("../utils/surveyResponses");
const { loadMenuForPartner } = require("../utils/surveySupport");
const { pageQuestion } = require("../utils/surveyFields");
const { isFeatureEnabled } = require("../utils/features");

// #419: a partner answers a survey through their personal link, with no account. The link's token
// is the only credential: it is stored as a hash, expires, is bound to one survey and one partner,
// and answers the page only with that survey's own questions: no partner data. Every failure
// (unknown, expired, closed) answers the same way so a guess learns nothing.
const router = express.Router();
router.use(requireFeature("surveys"));
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
  // A "how can we support you?" question only works while Support preferences is on (its answers could not be
  // approved otherwise), so a partner is not asked it, or held to it, after that is switched off.
  if (invite.survey.questions.some((q) => q.kind === "support")) {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    if (!isFeatureEnabled(settings?.enabledFeatures, "supportPreferences")) {
      invite.survey.questions = invite.survey.questions.filter((q) => q.kind !== "support");
    }
  }
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
    const photos = await prisma.surveyUpload.findMany({
      where: { responseId: response?.id || "none" },
      select: { questionId: true },
    });
    const church = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { churchName: true },
    });
    const hasSupport = invite.survey.questions.some((q) => q.kind === "support");
    res.json({
      churchName: church?.churchName || null,
      supportMenu: hasSupport ? await loadMenuForPartner() : [],
      title: invite.survey.title,
      intro: invite.survey.intro,
      submitted: Boolean(response?.submittedAt),
      questions: invite.survey.questions.map((q) => {
        const p = pageQuestion(q);
        return {
          id: p.id,
          kind: p.kind,
          label: p.label,
          choices: p.choices,
          allowOther: p.allowOther,
          required: p.required,
          inputType: p.inputType,
          maxLength: p.maxLength,
          labels: p.labels,
        };
      }),
      photos: photos.map((p) => p.questionId).filter(Boolean),
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
    res.json({
      saved: true,
      submitted: Boolean(result.response.submittedAt),
      // Answers a "finish later" save could not keep (and why); the rest were saved.
      skipped: result.skipped || [],
    });
  } catch (err) {
    next(err);
  }
}
router.put("/:token", (req, res, next) => save(req, res, next, false));
router.post("/:token/submit", (req, res, next) => save(req, res, next, true));

// A photo for a photo question, as { contentType, data } with base64 data. It has its own
// path (server.js gives it a larger body limit and a tighter rate limit) and waits for staff to
// approve it before it touches the partner's record.
const uploadRouter = express.Router();
uploadRouter.use(requireFeature("surveys"));
uploadRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 20 }));
uploadRouter.post("/:token/:questionId", async (req, res, next) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json(NOT_AVAILABLE);
    const { contentType, data } = z
      .object({ contentType: z.string().max(40), data: z.string().max(24 * 1024 * 1024) })
      .parse(req.body);
    const result = await saveSurveyPhoto({
      survey: invite.survey,
      partnerId: invite.partnerId,
      questionId: req.params.questionId,
      contentType,
      buffer: Buffer.from(data, "base64"),
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.uploadRouter = uploadRouter;
