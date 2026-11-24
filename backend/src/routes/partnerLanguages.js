const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const {
  requireAuth,
  requireRole,
  requirePartnerQueryScope,
  requirePartnerWriter,
} = require("../middleware/requireAuth");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { PROFICIENCY_LEVELS } = require("./proficiencyLevels");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The only writer for PartnerLanguage -- see routes/adults.js for the full
// reasoning, same shape, no consolidated cross-partner list. `language`
// stays freeform (datalist-suggested in the admin UI, see
// frontend/src/utils/languageNames.js) since the real-world set is open-
// ended, unlike `proficiency`, a fixed ILR scale (see proficiencyLevels.js).
const partnerLanguageSchema = z.object({
  partnerId: z.string(),
  language: z.string().min(1),
  proficiency: z.enum(PROFICIENCY_LEVELS).optional().nullable(),
});

const partnerLanguageInclude = { partner: partnerRefSelect };

// GET /api/partner-languages?partnerId=
router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.partnerLanguage.findMany({
      where,
      include: partnerLanguageInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/partner-languages  (create — editor or admin)
router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = partnerLanguageSchema.parse(req.body);
    const created = await prisma.partnerLanguage.create({ data, include: partnerLanguageInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/partner-languages/:id  (update — editor or admin) -- mainly for
// updating just the proficiency level as someone's field language
// improves, without touching the language itself.
router.put("/:id", requirePartnerWriter({ model: "partnerLanguage" }), async (req, res, next) => {
  try {
    const data = partnerLanguageSchema.partial().parse(req.body);
    const updated = await prisma.partnerLanguage.update({
      where: { id: req.params.id },
      data,
      include: partnerLanguageInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/partner-languages/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.partnerLanguage.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
