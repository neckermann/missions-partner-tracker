const express = require("express");
const { z } = require("zod");
const { phoneSchema, emailSchema } = require("../utils/contactFormat");
const { CONTACT_METHODS } = require("../utils/contactMethods");
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

// The only writer for Adult, same shape as routes/prayerRequests.js. There is
// no cross-partner list; adults are only managed on a partner's page.
const adultSchema = z.object({
  partnerId: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  phone1: phoneSchema(z),
  phone2: phoneSchema(z),
  email: emailSchema(z),
  birthday: z.coerce.date().optional().nullable(),
  // At most one per partner; setting it clears it from the others (clearPrimary).
  isPrimaryContact: z.boolean().optional(),
  contactMethod: z.enum(CONTACT_METHODS).optional().nullable(),
  contactMethodNote: z.string().trim().max(200).optional().nullable(),
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

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.adult.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
