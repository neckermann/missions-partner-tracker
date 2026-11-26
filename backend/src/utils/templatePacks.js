// Template packs: a church's own starting points, as plain JSON a person can read, edit, share and
// import. The app ships none of this content in code (the fork-upgradability rule): examples live
// as files in examples/template-packs/ and are imported like any other pack. A pack is an envelope
// { format, version, kind, title, description, data }; each kind knows how to validate its `data`,
// summarize it for a preview, apply it (always additive, never deleting what a church has), and
// export what a church has back out. Admin only; see routes/templatePacks.js.
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { KIND_VALUES: SURVEY_KINDS, MAX_CHOICES, shapeQuestion } = require("./surveys");
const { KIND_VALUES: SUPPORT_KINDS, CHOICE_KINDS: SUPPORT_CHOICE_KINDS } = require("./supportOptions");
const { QUESTION_TYPES, REQUIREMENT_KINDS } = require("./applicationQuestions");
const { loadChurchLists, replaceQuestions, replaceRequirementItems } = require("./tripTemplates");

const FORMAT = "missions-partner-tracker-pack";
const VERSION = 1;

const text = (max) => z.string().trim().min(1).max(max);
const longText = (max) => z.string().max(max);

const envelope = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  kind: z.string(),
  title: text(120),
  description: longText(600).optional().default(""),
  data: z.unknown(),
});

// ---- survey ----
const surveyData = z.object({
  survey: z.object({
    title: text(200),
    intro: longText(5000).optional().nullable(),
    questions: z
      .array(
        z.object({
          kind: z.enum(SURVEY_KINDS),
          label: text(500),
          choices: z.array(text(100)).max(MAX_CHOICES).optional(),
          allowOther: z.boolean().optional(),
          required: z.boolean().optional(),
          field: z.string().max(60).optional().nullable(),
        })
      )
      .min(1)
      .max(100),
  }),
});

// ---- support menu ----
const supportData = z.object({
  options: z
    .array(
      z.object({
        group: text(80),
        label: text(300),
        kind: z.enum(SUPPORT_KINDS).optional().default("offer"),
        choices: z.array(text(100)).max(MAX_CHOICES).optional(),
        allowOther: z.boolean().optional(),
        staffOnly: z.boolean().optional(),
      })
    )
    .min(1)
    .max(300),
});

// ---- trip application questions ----
const questionItem = z
  .object({
    label: text(500),
    required: z.boolean().optional(),
    type: z.enum(QUESTION_TYPES).optional(),
    options: z.array(text(200)).max(50).optional(),
  })
  .refine((q) => !["select", "checkboxes"].includes(q.type) || (q.options && q.options.length > 0), {
    message: "Multiple-choice and checkbox questions need at least one option",
  });
const questionsData = z.object({
  tripApplicationTemplate: z.array(questionItem).max(100).optional().default([]),
  tripQuestionLibrary: z.array(questionItem).max(200).optional().default([]),
});

// ---- trip requirements ----
const requirementItem = z.object({
  label: text(300),
  kind: z.enum(REQUIREMENT_KINDS).optional(),
  bodyText: longText(30000).optional().nullable(),
  reminderLeadDays: z.number().int().positive().max(3650).optional().nullable(),
  minorsOnly: z.boolean().optional(),
});
const requirementsData = z.object({
  tripRequirementTemplate: z.array(requirementItem).max(100).optional().default([]),
  tripRequirementLibrary: z.array(requirementItem).max(200).optional().default([]),
});

// ---- email update wording ----
const wordingData = z.object({
  emailDispatchSubjectTemplate: longText(300).optional().nullable(),
  emailDispatchSignature: longText(2000).optional().nullable(),
  emailDispatchLayout: z.enum(["classic", "snapshot"]).optional().nullable(),
});

const uuid = () => crypto.randomUUID();
const labelKey = (s) => String(s).trim().toLowerCase();

const KINDS = {
  survey: {
    label: "Survey",
    requires: ["surveys"],
    schema: surveyData,
    summarize: (d) => [`A draft survey “${d.survey.title}” with ${d.survey.questions.length} questions`],
    async apply(data) {
      const shaped = [];
      for (const [position, q] of data.survey.questions.entries()) {
        const s = shapeQuestion({ ...q, field: q.field || null });
        if (s.error) return { error: s.error };
        shaped.push({ position, kind: q.kind, label: q.label, required: q.required === true, ...s });
      }
      const created = await prisma.survey.create({
        data: {
          title: data.survey.title,
          intro: data.survey.intro || null,
          questions: { create: shaped },
        },
      });
      return { message: `Added the draft survey “${created.title}”.`, surveyId: created.id };
    },
    async exportData({ surveyId }) {
      const survey = await prisma.survey.findUnique({
        where: { id: surveyId },
        include: { questions: { orderBy: { position: "asc" } } },
      });
      if (!survey) return null;
      return {
        title: survey.title,
        data: {
          survey: {
            title: survey.title,
            intro: survey.intro || "",
            questions: survey.questions.map((q) => {
              const o = { kind: q.kind, label: q.label };
              if (q.choices.length) o.choices = q.choices;
              if (q.allowOther) o.allowOther = true;
              if (q.required) o.required = true;
              if (q.field) o.field = q.field;
              return o;
            }),
          },
        },
      };
    },
  },

  supportMenu: {
    label: "Support menu",
    requires: ["supportPreferences", "careTeam"],
    schema: supportData,
    summarize: (d) => [
      `${d.options.length} support options, in ${new Set(d.options.map((o) => o.group)).size} groups`,
    ],
    async apply(data) {
      for (const o of data.options) {
        const isChoice = SUPPORT_CHOICE_KINDS.includes(o.kind);
        if (isChoice && !(o.choices?.length || o.allowOther)) {
          return { error: `“${o.label}” needs at least one choice, or an “other” box` };
        }
      }
      const existing = await prisma.supportOption.findMany({
        select: { group: true, label: true, sortOrder: true },
      });
      const have = new Set(existing.map((o) => `${labelKey(o.group)}|${labelKey(o.label)}`));
      const next = new Map();
      existing.forEach((o) => next.set(o.group, Math.max(next.get(o.group) || 0, o.sortOrder)));
      const rows = [];
      for (const o of data.options) {
        if (have.has(`${labelKey(o.group)}|${labelKey(o.label)}`)) continue;
        have.add(`${labelKey(o.group)}|${labelKey(o.label)}`);
        const n = (next.get(o.group) || 0) + 1;
        next.set(o.group, n);
        const isChoice = SUPPORT_CHOICE_KINDS.includes(o.kind);
        rows.push({
          group: o.group,
          label: o.label,
          kind: o.kind,
          choices: isChoice ? [...new Set(o.choices || [])] : [],
          allowOther: isChoice ? o.allowOther === true : false,
          staffOnly: o.staffOnly === true,
          sortOrder: n,
        });
      }
      if (rows.length) await prisma.supportOption.createMany({ data: rows });
      const skipped = data.options.length - rows.length;
      return {
        message: `Added ${rows.length} support option${rows.length === 1 ? "" : "s"}${skipped ? ` (${skipped} already on your menu)` : ""}.`,
      };
    },
    async exportData() {
      const options = await prisma.supportOption.findMany({
        where: { active: true },
        orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      });
      return {
        title: "Our support menu",
        data: {
          options: options.map((o) => {
            const r = { group: o.group, label: o.label, kind: o.kind };
            if (o.choices.length) r.choices = o.choices;
            if (o.allowOther) r.allowOther = true;
            if (o.staffOnly) r.staffOnly = true;
            return r;
          }),
        },
      };
    },
  },

  applicationQuestions: {
    label: "Trip application questions",
    requires: ["trips"],
    schema: questionsData,
    summarize: (d) => [
      `${d.tripApplicationTemplate.length} questions every application asks`,
      `${d.tripQuestionLibrary.length} library questions to pick from per trip`,
    ],
    async apply(data) {
      const lists = await loadChurchLists();
      const merge = (current, incoming) => {
        const have = new Set(current.map((q) => labelKey(q.label)));
        const add = incoming.filter((q) => !have.has(labelKey(q.label))).map((q) => ({ ...q, id: uuid() }));
        return { merged: [...current, ...add], added: add.length };
      };
      const t = merge(lists.tripApplicationTemplate, data.tripApplicationTemplate);
      const l = merge(lists.tripQuestionLibrary, data.tripQuestionLibrary);
      await prisma.$transaction(async (tx) => {
        if (t.added) await replaceQuestions(tx, "template", null, t.merged);
        if (l.added) await replaceQuestions(tx, "library", null, l.merged);
      });
      return {
        message: `Added ${t.added} application question${t.added === 1 ? "" : "s"} and ${l.added} to the library.`,
      };
    },
    async exportData() {
      const lists = await loadChurchLists();
      const strip = ({ id, ...rest }) => rest;
      return {
        title: "Our trip application questions",
        data: {
          tripApplicationTemplate: lists.tripApplicationTemplate.map(strip),
          tripQuestionLibrary: lists.tripQuestionLibrary.map(strip),
        },
      };
    },
  },

  tripRequirements: {
    label: "Trip requirement documents",
    requires: ["trips"],
    schema: requirementsData,
    summarize: (d) => [
      `${d.tripRequirementTemplate.length} requirements added to every new trip`,
      `${d.tripRequirementLibrary.length} library requirements to pick from per trip`,
    ],
    async apply(data) {
      const lists = await loadChurchLists();
      const merge = (current, incoming) => {
        const have = new Set(current.map((r) => labelKey(r.label)));
        const add = incoming.filter((r) => !have.has(labelKey(r.label))).map((r) => ({ ...r, id: uuid() }));
        return { merged: [...current, ...add], added: add.length };
      };
      const t = merge(lists.tripRequirementTemplate, data.tripRequirementTemplate);
      const l = merge(lists.tripRequirementLibrary, data.tripRequirementLibrary);
      await prisma.$transaction(async (tx) => {
        if (t.added) await replaceRequirementItems(tx, "template", t.merged);
        if (l.added) await replaceRequirementItems(tx, "library", l.merged);
      });
      return {
        message: `Added ${t.added} requirement${t.added === 1 ? "" : "s"} for every trip and ${l.added} to the library.`,
      };
    },
    async exportData() {
      const lists = await loadChurchLists();
      const strip = ({ id, ...rest }) => rest;
      return {
        title: "Our trip requirement documents",
        data: {
          tripRequirementTemplate: lists.tripRequirementTemplate.map(strip),
          tripRequirementLibrary: lists.tripRequirementLibrary.map(strip),
        },
      };
    },
  },

  dispatchWording: {
    label: "Email update wording",
    requires: [],
    schema: wordingData,
    summarize: (d) => [
      "Replaces your email update subject line, sign-off and layout with these (anything left out is kept)",
      ...(d.emailDispatchSubjectTemplate ? [`Subject: ${d.emailDispatchSubjectTemplate}`] : []),
    ],
    async apply(data, { userId }) {
      const patch = {};
      for (const k of ["emailDispatchSubjectTemplate", "emailDispatchSignature", "emailDispatchLayout"]) {
        if (data[k] !== undefined) patch[k] = data[k] || null;
      }
      await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...patch, updatedById: userId },
        update: { ...patch, updatedById: userId },
      });
      return { message: "Updated your email update wording." };
    },
    async exportData() {
      const s = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: {
          emailDispatchSubjectTemplate: true,
          emailDispatchSignature: true,
          emailDispatchLayout: true,
        },
      });
      return { title: "Our email update wording", data: { ...(s || {}) } };
    },
  },
};

const KIND_KEYS = Object.keys(KINDS);

// Reads and checks a pack from untrusted JSON. Returns { pack, handler } or { error }.
function parsePack(raw) {
  let input = raw;
  if (typeof raw === "string") {
    try {
      input = JSON.parse(raw);
    } catch {
      return { error: "That isn't valid JSON" };
    }
  }
  const env = envelope.safeParse(input);
  if (!env.success) {
    const issue = env.error.issues[0];
    if (issue?.path?.[0] === "format" || issue?.path?.[0] === "version") {
      return { error: "That doesn't look like a Missions Partner Tracker template pack" };
    }
    return {
      error: `The pack isn't valid: ${issue?.path?.join(".") || "envelope"} ${issue?.message || ""}`.trim(),
    };
  }
  const handler = KINDS[env.data.kind];
  if (!handler) return { error: `This version doesn't know the pack kind “${env.data.kind}”` };
  const data = handler.schema.safeParse(env.data.data);
  if (!data.success) {
    const issue = data.error.issues[0];
    return { error: `The pack's contents aren't valid: ${issue.path.join(".")} ${issue.message}`.trim() };
  }
  return { pack: { ...env.data, data: data.data }, handler };
}

// The envelope around exported data.
function buildPack(kind, { title, data }, description = "") {
  return { format: FORMAT, version: VERSION, kind, title, description, data };
}

module.exports = { FORMAT, VERSION, KINDS, KIND_KEYS, parsePack, buildPack };
