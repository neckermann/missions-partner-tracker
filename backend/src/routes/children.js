const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { partnerRefSelect } = require("../utils/prismaIncludes");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The only writer for Child -- see routes/adults.js for the full reasoning,
// same shape, no consolidated cross-partner list.
const childSchema = z.object({
  partnerId: z.string(),
  name: z.string().min(1),
  birthday: z.coerce.date().optional().nullable(),
});

const childInclude = { partner: partnerRefSelect };

// GET /api/children?partnerId=
router.get("/", async (req, res, next) => {
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

// POST /api/children  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = childSchema.parse(req.body);
    const created = await prisma.child.create({ data, include: childInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/children/:id  (update — editor or admin)
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = childSchema.partial().parse(req.body);
    const updated = await prisma.child.update({ where: { id: req.params.id }, data, include: childInclude });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/children/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.child.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
