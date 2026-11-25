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

// The only writer for TripType; see routes/adults.js for the shared shape. `type` is freeform
// (preset-or-custom in the admin UI) since a church can support a trip type the app does not know.
const tripTypeSchema = z.object({
  partnerId: z.string(),
  type: z.string().min(1),
});

const tripTypeInclude = { partner: partnerRefSelect };

// GET /api/trip-types?partnerId=
router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.tripType.findMany({
      where,
      include: tripTypeInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/trip-types  (create — editor or admin)
router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = tripTypeSchema.parse(req.body);
    const created = await prisma.tripType.create({ data, include: tripTypeInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/trip-types/:id  (update — editor or admin)
router.put("/:id", requirePartnerWriter({ model: "tripType" }), async (req, res, next) => {
  try {
    const data = tripTypeSchema.partial().parse(req.body);
    const updated = await prisma.tripType.update({
      where: { id: req.params.id },
      data,
      include: tripTypeInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/trip-types/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.tripType.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
