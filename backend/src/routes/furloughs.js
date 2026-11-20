const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { partnerRefSelect } = require("../utils/prismaIncludes");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The only writer for Furlough -- see routes/adults.js for the full
// reasoning, same shape, no consolidated cross-partner list. endDate is
// optional/nullable for an open-ended/ongoing furlough.
const furloughSchema = z.object({
  partnerId: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const furloughInclude = { partner: partnerRefSelect };

// GET /api/furloughs?partnerId=
router.get("/", async (req, res, next) => {
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

// POST /api/furloughs  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = furloughSchema.parse(req.body);
    const created = await prisma.furlough.create({ data, include: furloughInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/furloughs/:id  (update — editor or admin)
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
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

// DELETE /api/furloughs/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.furlough.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
