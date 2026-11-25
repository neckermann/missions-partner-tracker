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

// The only writer for Child; same shape as routes/adults.js.
const childSchema = z.object({
  partnerId: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  birthday: z.coerce.date().optional().nullable(),
});

const childInclude = { partner: partnerRefSelect };

router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.child.findMany({
      where,
      include: childInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = childSchema.parse(req.body);
    const created = await prisma.child.create({ data, include: childInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requirePartnerWriter({ model: "child" }), async (req, res, next) => {
  try {
    const data = childSchema.partial().parse(req.body);
    const updated = await prisma.child.update({ where: { id: req.params.id }, data, include: childInclude });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.child.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
