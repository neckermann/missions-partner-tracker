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

// The only writer for Furlough; same shape as routes/adults.js. A null endDate
// means an open-ended furlough.
const furloughSchema = z.object({
  partnerId: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const furloughInclude = { partner: partnerRefSelect };

router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.furlough.findMany({
      where,
      include: furloughInclude,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = furloughSchema.parse(req.body);
    const created = await prisma.furlough.create({ data, include: furloughInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requirePartnerWriter({ model: "furlough" }), async (req, res, next) => {
  try {
    const data = furloughSchema.partial().parse(req.body);
    const updated = await prisma.furlough.update({
      where: { id: req.params.id },
      data,
      include: furloughInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.furlough.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
