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
router.use(requireAuth); // everything below requires a logged-in user

// The only writer for Adult, same shape as routes/prayerRequests.js.
// Backs both the "Add Adult" quick-add popup and the standalone edit of an
// existing one on a single partner's page -- there's no consolidated
// cross-partner list for this resource, unlike Prayer Requests/One-Time
// Needs/Monthly Support.
const adultSchema = z.object({
  partnerId: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  birthday: z.coerce.date().optional().nullable(),
  // #288: the adult to reach first -- at most one per partner. Setting it
  // here clears it from the others in the same write (below).
  isPrimaryContact: z.boolean().optional(),
});

const adultInclude = { partner: partnerRefSelect };

// Cleared first so moving the flag never briefly leaves two primaries (the
// partial unique index would refuse that).
async function clearPrimary(db, partnerId) {
  await db.adult.updateMany({
    where: { partnerId, isPrimaryContact: true },
    data: { isPrimaryContact: false },
  });
}

// GET /api/adults?partnerId=
router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.adult.findMany({
      where,
      include: adultInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/adults  (create — editor or admin)
router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = adultSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      if (data.isPrimaryContact) await clearPrimary(tx, data.partnerId);
      return tx.adult.create({ data, include: adultInclude });
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/adults/:id  (update — editor or admin)
router.put("/:id", requirePartnerWriter({ model: "adult" }), async (req, res, next) => {
  try {
    const data = adultSchema.partial().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isPrimaryContact) {
        const current = await tx.adult.findUnique({
          where: { id: req.params.id },
          select: { partnerId: true },
        });
        if (current) await clearPrimary(tx, data.partnerId || current.partnerId);
      }
      return tx.adult.update({ where: { id: req.params.id }, data, include: adultInclude });
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/adults/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.adult.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
