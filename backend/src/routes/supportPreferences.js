const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { readableNeedPartnerIds } = require("../utils/guestAccess");
const { recordAuditSafe } = require("../utils/auditLog");
const {
  KINDS,
  KIND_VALUES,
  CHOICE_KINDS,
  MAX_CHOICES,
  normalizeResponse,
  addExampleOptions,
} = require("../utils/supportOptions");

// #374: support preferences. Gated by the `supportPreferences` feature, which needs Care
// teams (404 when either is off, data kept).
//
// The menu (SupportOption) is the church's, edited by an admin. A partner's choices from it
// are read by anyone who can see the partner except a trip leader, and recorded by an admin,
// an editor, or a guest holding a care team seat on that partner (the same reach as the contact
// log and one-time needs: `readableNeedPartnerIds`). A viewer reads but doesn't write, as
// everywhere. Never public, never in the booklet or a dispatch: nothing here is exposed
// outside a signed-in session.
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("supportPreferences"));
router.use(requireFeature("careTeam"));
router.use(requireRole("admin", "editor", "viewer", "guest"));

function canUse(user, partnerId) {
  const ids = readableNeedPartnerIds(user);
  return ids === null || ids.includes(partnerId);
}

const canWrite = (user) => user.role !== "viewer";

const optionFields = {
  group: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(300),
  kind: z.enum(KIND_VALUES),
  choices: z.array(z.string().trim().min(1).max(100)).max(MAX_CHOICES).optional().nullable(),
  allowOther: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
};
const optionSchema = z.object(optionFields);

// A choice question needs choices (or an "other" box); the other kinds carry neither.
function shapeOption(data) {
  const isChoice = CHOICE_KINDS.includes(data.kind);
  const choices = isChoice ? [...new Set(data.choices || [])] : null;
  const allowOther = isChoice ? data.allowOther === true : false;
  if (isChoice && choices.length === 0 && !allowOther) {
    return { error: "A pick-one or pick-any question needs at least one choice, or an “other” box" };
  }
  return { choices: choices || [], allowOther };
}

const audit = (req, label, details) =>
  recordAuditSafe(null, {
    action: "settings.updated",
    actor: req.user,
    entity: { type: "settings", label: "Support preferences menu" },
    req,
    details: { [label]: details },
  });

// GET /api/support-preferences/kinds -- the fixed kinds, so the frontend keeps no copy.
router.get("/kinds", (req, res) => res.json({ kinds: KINDS }));

// GET /api/support-preferences/options -- every option, retired ones too, with how many
// partners have answered each.
router.get("/options", requireRole("admin"), async (req, res, next) => {
  try {
    const options = await prisma.supportOption.findMany({
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { preferences: true } } },
    });
    res.json(options.map(({ _count, ...o }) => ({ ...o, answerCount: _count.preferences })));
  } catch (err) {
    next(err);
  }
});

// POST /api/support-preferences/options/example-set -- adds the example menu when the
// catalog is empty. Registered before "/options/:id" so "example-set" isn't read as an id.
router.post("/options/example-set", requireRole("admin"), async (req, res, next) => {
  try {
    const added = await addExampleOptions();
    if (added === 0) return res.status(409).json({ error: "The menu already has options" });
    await audit(req, "exampleSetAdded", added);
    res.status(201).json({ added });
  } catch (err) {
    next(err);
  }
});

// POST /api/support-preferences/options/rename-group -- a group is just the text on its
// options, so renaming one is renaming it on each.
router.post("/options/rename-group", requireRole("admin"), async (req, res, next) => {
  try {
    const { from, to } = z
      .object({ from: z.string().trim().min(1).max(80), to: z.string().trim().min(1).max(80) })
      .parse(req.body);
    const { count } = await prisma.supportOption.updateMany({ where: { group: from }, data: { group: to } });
    if (count === 0) return res.status(404).json({ error: "Not found" });
    await audit(req, "groupRenamed", { from, to });
    res.json({ renamed: count });
  } catch (err) {
    next(err);
  }
});

router.post("/options", requireRole("admin"), async (req, res, next) => {
  try {
    const data = optionSchema.parse(req.body);
    const shaped = shapeOption(data);
    if (shaped.error) return res.status(400).json({ error: shaped.error });
    const created = await prisma.supportOption.create({
      data: {
        group: data.group,
        label: data.label,
        kind: data.kind,
        choices: shaped.choices,
        allowOther: shaped.allowOther,
        sortOrder: data.sortOrder ?? 0,
        active: data.active ?? true,
      },
    });
    await audit(req, "optionAdded", created.label);
    res.status(201).json({ ...created, answerCount: 0 });
  } catch (err) {
    next(err);
  }
});

router.put("/options/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.supportOption.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const data = optionSchema.partial().parse(req.body);
    const merged = { ...existing, ...data };
    // Changing what kind of question it is would strand the answers already given.
    if (data.kind && data.kind !== existing.kind) {
      const answered = await prisma.partnerSupportPreference.count({ where: { optionId: existing.id } });
      if (answered > 0) {
        return res.status(409).json({
          error:
            "Partners have already answered this, so its kind can't change. Retire it and add a new one.",
        });
      }
    }
    const shaped = shapeOption(merged);
    if (shaped.error) return res.status(400).json({ error: shaped.error });
    const updated = await prisma.supportOption.update({
      where: { id: existing.id },
      data: { ...data, choices: shaped.choices, allowOther: shaped.allowOther },
    });
    await audit(req, data.active === false ? "optionRetired" : "optionChanged", updated.label);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE removes the option and every partner's answer to it; retiring it (active: false) is
// the way to stop offering it and keep what was said.
router.delete("/options/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.supportOption.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await prisma.supportOption.delete({ where: { id: existing.id } });
    await audit(req, "optionDeleted", existing.label);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const lastEditedFields = { lastEditedByName: true, lastEditedAt: true };

// GET /api/support-preferences/partner/:partnerId -- the menu (active options, plus retired
// ones this partner has an answer to) and the partner's responses.
router.get("/partner/:partnerId", async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return res.status(404).json({ error: "Not found" });
    const preferences = await prisma.partnerSupportPreference.findMany({
      where: { partnerId },
      select: {
        optionId: true,
        selected: true,
        choice: true,
        choices: true,
        other: true,
        text: true,
        note: true,
        ...lastEditedFields,
      },
    });
    const answered = preferences.map((p) => p.optionId);
    const options = await prisma.supportOption.findMany({
      where: { OR: [{ active: true }, { id: { in: answered } }] },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json({ options, preferences, canEdit: canWrite(req.user) });
  } catch (err) {
    next(err);
  }
});

const responseSchema = z.object({
  optionId: z.string().min(1),
  selected: z.boolean().optional(),
  choice: z.string().max(100).optional().nullable(),
  choices: z.array(z.string().max(100)).max(MAX_CHOICES).optional(),
  other: z.string().max(200).optional().nullable(),
  text: z.string().max(5000).optional().nullable(),
  note: z.string().max(5000).optional().nullable(),
});
const saveSchema = z.object({ preferences: z.array(responseSchema).max(500) });

// PUT /api/support-preferences/partner/:partnerId -- sets the responses sent: each is stored,
// or removed when it is empty (not selected, no answer, no note). Options not mentioned are
// left alone.
router.put("/partner/:partnerId", async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    if (!canWrite(req.user)) return res.status(403).json({ error: "Insufficient permissions" });
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return res.status(404).json({ error: "Not found" });
    const { preferences } = saveSchema.parse(req.body);

    const optionIds = [...new Set(preferences.map((p) => p.optionId))];
    const options = await prisma.supportOption.findMany({ where: { id: { in: optionIds } } });
    const byId = new Map(options.map((o) => [o.id, o]));
    const existing = await prisma.partnerSupportPreference.findMany({
      where: { partnerId, optionId: { in: optionIds } },
      select: { optionId: true },
    });
    const hadAnswer = new Set(existing.map((e) => e.optionId));

    const toSave = [];
    const toClear = [];
    for (const item of preferences) {
      const option = byId.get(item.optionId);
      if (!option) return res.status(400).json({ error: "That option doesn't exist" });
      const result = normalizeResponse(option, item);
      if (result.error) return res.status(400).json({ error: result.error });
      if (result.empty) {
        toClear.push(option.id);
        continue;
      }
      // A retired option can no longer be newly answered; an existing answer can still be edited.
      if (!option.active && !hadAnswer.has(option.id)) {
        return res.status(400).json({ error: `"${option.label}" is no longer offered` });
      }
      toSave.push({ option, ...result });
    }

    await prisma.$transaction(async (tx) => {
      if (toClear.length) {
        await tx.partnerSupportPreference.deleteMany({ where: { partnerId, optionId: { in: toClear } } });
      }
      for (const { option, ...columns } of toSave) {
        await tx.partnerSupportPreference.upsert({
          where: { partnerId_optionId: { partnerId, optionId: option.id } },
          create: { partnerId, optionId: option.id, ...columns },
          update: columns,
        });
      }
    });
    res.json({ saved: toSave.length, cleared: toClear.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
