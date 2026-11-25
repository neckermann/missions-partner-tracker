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

const router = express.Router();
router.use(requireAuth);

// The only writer for ChurchVisit; same shape as routes/adults.js.
const churchVisitSchema = z.object({
  partnerId: z.string(),
  visitDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

const churchVisitInclude = { partner: partnerRefSelect };

router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.churchVisit.findMany({
      where,
      include: churchVisitInclude,
      orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = churchVisitSchema.parse(req.body);
    const created = await prisma.churchVisit.create({ data, include: churchVisitInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requirePartnerWriter({ model: "churchVisit" }), async (req, res, next) => {
  try {
    const data = churchVisitSchema.partial().parse(req.body);
    const updated = await prisma.churchVisit.update({
      where: { id: req.params.id },
      data,
      include: churchVisitInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.churchVisit.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
