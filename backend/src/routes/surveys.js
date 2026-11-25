const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { readableNeedPartnerIds } = require("../utils/guestAccess");
const { recordAuditSafe } = require("../utils/auditLog");
const { isFeatureEnabled } = require("../utils/features");
const { isDemoDeployment } = require("../utils/demoMode");
const { sendEmail } = require("../utils/email");
const { buildSurveyEmail } = require("../utils/surveyEmails");
const { saveSurveyAnswers } = require("../utils/surveyResponses");

const {
  KINDS,
  KIND_VALUES,
  MAX_CHOICES,
  newInviteToken,
  buildSurveyUrl,
  emailBlockReason,
  surveyEmailFor,
  shapeQuestion,
} = require("../utils/surveys");
const { listFields } = require("../utils/surveyFields");

// #419: partner surveys. Gated by the `surveys` feature, which needs Care teams (404 when either
// is off, data kept). A church builds surveys; a person sends each chosen partner a personal link
// (see publicSurveys.js for the partner's side); staff or a care team member can also fill one in
// on a partner's behalf. Answers are read by anyone who can see the partner except a trip leader.
// Nothing here is public, in the booklet or in a dispatch.
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("surveys"));
router.use(requireFeature("careTeam"));
router.use(requireRole("admin", "editor", "viewer", "guest"));

const canWrite = (user) => user.role !== "viewer" && user.role !== "guest";
function canUse(user, partnerId) {
  const ids = readableNeedPartnerIds(user);
  return ids === null || ids.includes(partnerId);
}
// Building and sending are staff work; a care team guest may only fill in for their partners.
const manage = requireRole("admin", "editor");

const audit = (req, label, details) =>
  recordAuditSafe(null, {
    action: "settings.updated",
    actor: req.user,
    entity: { type: "settings", label: "Surveys" },
    req,
    details: { [label]: details },
  });

const surveySchema = z.object({
  title: z.string().trim().min(1).max(200),
  intro: z.string().trim().max(5000).optional().nullable(),
  closesAt: z.string().datetime().optional().nullable(),
});
const updateSchema = surveySchema
  .partial()
  .extend({ status: z.enum(["draft", "open", "closed"]).optional() });

const questionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(KIND_VALUES),
  label: z.string().trim().min(1).max(500),
  choices: z.array(z.string().trim().min(1).max(100)).max(MAX_CHOICES).optional().nullable(),
  allowOther: z.boolean().optional(),
  required: z.boolean().optional(),
  field: z.string().optional().nullable(),
});

router.get("/kinds", (req, res) => res.json({ kinds: KINDS }));

// GET /api/surveys/fields -- the parts of a partner's record a question can propose a change to.
router.get("/fields", manage, (req, res) => res.json({ fields: listFields() }));

// GET /api/surveys -- every survey with how many questions, invitations and answers.
router.get("/", manage, async (req, res, next) => {
  try {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { questions: true, invites: true } } },
    });
    const submitted = await prisma.surveyResponse.groupBy({
      by: ["surveyId"],
      where: { submittedAt: { not: null } },
      _count: { _all: true },
    });
    const answeredBy = new Map(submitted.map((r) => [r.surveyId, r._count._all]));
    res.json({
      surveys: surveys.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        closesAt: s.closesAt,
        questionCount: s._count.questions,
        invitedCount: s._count.invites,
        answeredCount: answeredBy.get(s.id) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", manage, async (req, res, next) => {
  try {
    const data = surveySchema.parse(req.body);
    const survey = await prisma.survey.create({
      data: {
        title: data.title,
        intro: data.intro || null,
        closesAt: data.closesAt ? new Date(data.closesAt) : null,
      },
    });
    await audit(req, "created survey", survey.title);
    res.status(201).json(survey);
  } catch (err) {
    next(err);
  }
});

// GET /api/surveys/partner/:partnerId -- the surveys open to this partner (or already answered):
// questions, their answers, and whether a link went out. Registered before /:id.
router.get("/partner/:partnerId", async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return res.status(404).json({ error: "Not found" });
    const responses = await prisma.surveyResponse.findMany({
      where: { partnerId },
      include: { answers: { orderBy: { position: "asc" } } },
    });
    const byId = new Map(responses.map((r) => [r.surveyId, r]));
    const surveys = await prisma.survey.findMany({
      where: { OR: [{ status: "open" }, { id: { in: [...byId.keys()] } }] },
      orderBy: { createdAt: "desc" },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    const invites = await prisma.surveyInvite.findMany({
      where: { partnerId, surveyId: { in: surveys.map((s) => s.id) } },
      select: { surveyId: true, sentAt: true, openedAt: true },
    });
    const inviteBy = new Map(invites.map((i) => [i.surveyId, i]));
    res.json({
      canEdit: canWrite(req.user) || req.user.role === "guest",
      surveys: surveys.map((s) => ({
        id: s.id,
        title: s.title,
        intro: s.intro,
        status: s.status,
        questions: s.questions,
        response: byId.get(s.id) || null,
        invite: inviteBy.get(s.id) || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const answersSchema = z.object({
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
  submit: z.boolean().optional(),
});

// PUT /api/surveys/:id/partner/:partnerId -- staff (or a care team guest) fill in for a partner.
router.put("/:id/partner/:partnerId", async (req, res, next) => {
  try {
    const { id, partnerId } = req.params;
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    if (req.user.role === "viewer") return res.status(403).json({ error: "Insufficient permissions" });
    const survey = await prisma.survey.findUnique({ where: { id } });
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!survey || !partner || survey.status === "draft") return res.status(404).json({ error: "Not found" });
    const { answers, submit } = answersSchema.parse(req.body);
    const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email;
    const result = await saveSurveyAnswers({
      survey,
      partnerId,
      answers,
      submit: submit === true,
      enteredBy: { id: req.user.id, name },
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ submitted: Boolean(result.response.submittedAt) });
  } catch (err) {
    next(err);
  }
});

// POST /api/surveys/:id/partner/:partnerId/reopen -- lets the partner (or staff) change a
// submitted response again.
router.post("/:id/partner/:partnerId/reopen", manage, async (req, res, next) => {
  try {
    const { id, partnerId } = req.params;
    const found = await prisma.surveyResponse.findUnique({
      where: { surveyId_partnerId: { surveyId: id, partnerId } },
      select: { id: true },
    });
    if (!found) return res.status(404).json({ error: "Not found" });
    await prisma.surveyResponse.update({ where: { id: found.id }, data: { submittedAt: null } });
    res.json({ reopened: true });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", manage, async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    if (!survey) return res.status(404).json({ error: "Not found" });
    res.json(survey);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", manage, async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const survey = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { questions: true } } },
    });
    if (!survey) return res.status(404).json({ error: "Not found" });
    if (data.status === "open" && survey._count.questions === 0) {
      return res.status(400).json({ error: "Add at least one question before opening the survey" });
    }
    const updated = await prisma.survey.update({
      where: { id: survey.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.intro !== undefined ? { intro: data.intro || null } : {}),
        ...(data.closesAt !== undefined ? { closesAt: data.closesAt ? new Date(data.closesAt) : null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    if (data.status && data.status !== survey.status)
      await audit(req, `survey ${data.status}`, updated.title);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!survey) return res.status(404).json({ error: "Not found" });
    await prisma.survey.delete({ where: { id: survey.id } });
    await audit(req, "deleted survey", survey.title);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/surveys/:id/questions -- the whole ordered list. A question that keeps its id keeps
// its answers; one left out is deleted (its answers stay, labelled as they were).
router.put("/:id/questions", manage, async (req, res, next) => {
  try {
    const { questions } = z.object({ questions: z.array(questionSchema).max(100) }).parse(req.body);
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!survey) return res.status(404).json({ error: "Not found" });
    const existing = await prisma.surveyQuestion.findMany({
      where: { surveyId: survey.id },
      select: { id: true },
    });
    const known = new Set(existing.map((q) => q.id));
    const shaped = [];
    for (const [position, q] of questions.entries()) {
      const s = shapeQuestion(q);
      if (s.error) return res.status(400).json({ error: s.error });
      shaped.push({ position, q, ...s });
    }
    const keep = new Set(shaped.map((s) => s.q.id).filter((i) => i && known.has(i)));
    await prisma.$transaction(async (tx) => {
      await tx.surveyQuestion.deleteMany({
        where: { surveyId: survey.id, id: { notIn: [...keep] } },
      });
      for (const { position, q, choices, allowOther } of shaped) {
        const data = {
          position,
          kind: q.kind,
          label: q.label,
          choices,
          allowOther,
          required: q.required === true,
        };
        if (q.id && known.has(q.id)) await tx.surveyQuestion.update({ where: { id: q.id }, data });
        else await tx.surveyQuestion.create({ data: { surveyId: survey.id, ...data } });
      }
    });
    const saved = await prisma.surveyQuestion.findMany({
      where: { surveyId: survey.id },
      orderBy: { position: "asc" },
    });
    res.json({ questions: saved });
  } catch (err) {
    next(err);
  }
});

// GET /api/surveys/:id/recipients -- every active partner with where they stand and whether the
// app may email them a link, so a person can review before sending.
router.get("/:id/recipients", manage, async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!survey) return res.status(404).json({ error: "Not found" });
    const partners = await prisma.partner.findMany({
      where: { archived: false },
      orderBy: { displayName: "asc" },
      include: { adults: true },
    });
    const invites = await prisma.surveyInvite.findMany({ where: { surveyId: survey.id } });
    const responses = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id } });
    const inviteBy = new Map(invites.map((i) => [i.partnerId, i]));
    const responseBy = new Map(responses.map((r) => [r.partnerId, r]));
    res.json({
      recipients: partners.map((p) => {
        const invite = inviteBy.get(p.id);
        const response = responseBy.get(p.id);
        const blocked = emailBlockReason(p);
        const email = surveyEmailFor(p, p.adults);
        return {
          partnerId: p.id,
          name: p.displayName,
          kind: p.kind,
          state: response?.submittedAt ? "answered" : invite?.sentAt ? "invited" : "not invited",
          sentAt: invite?.sentAt || null,
          canEmail: !blocked && Boolean(email),
          blockedReason: blocked || (email ? null : "no email on file"),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

const sendSchema = z.object({
  partnerIds: z.array(z.string().min(1)).min(1).max(1000),
  reminder: z.boolean().optional(),
});

// POST /api/surveys/:id/send -- a person starts every send. Each chosen partner gets a fresh
// personal link by email (an earlier link stops working). Partners the app may not email, or
// with no address, are reported back, never skipped silently.
router.post("/:id/send", manage, async (req, res, next) => {
  try {
    const { partnerIds, reminder } = sendSchema.parse(req.body);
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!survey) return res.status(404).json({ error: "Not found" });
    if (survey.status !== "open") return res.status(400).json({ error: "Open the survey before sending it" });
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
      return res.status(400).json({ error: "Turn on Email (Sending) to send survey links" });
    }
    if (!buildSurveyUrl("probe")) {
      return res.status(400).json({ error: "APP_BASE_URL isn't set, so a link can't be built" });
    }
    if (isDemoDeployment()) {
      return res.status(400).json({ error: "The demo never emails anyone, so links can't be sent here" });
    }

    const partners = await prisma.partner.findMany({
      where: { id: { in: partnerIds }, archived: false },
      include: { adults: true },
    });
    const answered = new Set(
      (
        await prisma.surveyResponse.findMany({
          where: { surveyId: survey.id, submittedAt: { not: null } },
          select: { partnerId: true },
        })
      ).map((r) => r.partnerId)
    );
    const sentBy = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email;
    let sent = 0;
    const skipped = [];
    for (const partner of partners) {
      if (answered.has(partner.id)) {
        skipped.push({ partnerId: partner.id, name: partner.displayName, reason: "already answered" });
        continue;
      }
      const blocked = emailBlockReason(partner);
      const to = surveyEmailFor(partner, partner.adults);
      if (blocked || !to) {
        skipped.push({
          partnerId: partner.id,
          name: partner.displayName,
          reason: blocked || "no email on file",
        });
        continue;
      }
      const { token, tokenHash, expiresAt } = newInviteToken();
      try {
        await sendEmail({
          to,
          ...buildSurveyEmail({
            partnerName: partner.displayName,
            survey,
            url: buildSurveyUrl(token),
            expiresAt,
            settings,
            reminder: reminder === true,
          }),
        });
      } catch {
        skipped.push({
          partnerId: partner.id,
          name: partner.displayName,
          reason: "the email failed to send",
        });
        continue;
      }
      await prisma.surveyInvite.upsert({
        where: { surveyId_partnerId: { surveyId: survey.id, partnerId: partner.id } },
        create: {
          surveyId: survey.id,
          partnerId: partner.id,
          tokenHash,
          expiresAt,
          sentAt: new Date(),
          sentById: req.user.id,
          sentByName: sentBy,
        },
        update: { tokenHash, expiresAt, sentAt: new Date(), sentById: req.user.id, sentByName: sentBy },
      });
      sent += 1;
    }
    await audit(
      req,
      reminder ? "sent survey reminders" : "sent survey links",
      `${survey.title}: ${sent} sent`
    );
    res.json({ sent, skipped });
  } catch (err) {
    next(err);
  }
});

// GET /api/surveys/:id/responses -- the answers, a partner at a time, for the results view.
router.get("/:id/responses", manage, async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    if (!survey) return res.status(404).json({ error: "Not found" });
    const responses = await prisma.surveyResponse.findMany({
      where: { surveyId: survey.id },
      include: {
        answers: { orderBy: { position: "asc" } },
        partner: { select: { id: true, displayName: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ survey, responses });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
