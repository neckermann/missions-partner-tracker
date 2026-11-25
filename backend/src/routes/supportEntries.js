const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { partnerRefSelect } = require("../utils/prismaIncludes");

const router = express.Router();
router.use(requireAuth);
// Gates the whole resource; this router is the only way in.
router.use(requireFeature("monthlySupport"));

// The only writer for SupportEntry. Deliberately no PUT: an entry is a point-in-time record of the
// monthly amount as of effectiveDate, like a financial ledger. A mistake is corrected by deleting the
// entry and adding a new one; "current support" is the entry with the latest effectiveDate.
const supportEntrySchema = z.object({
  partnerId: z.string(),
  amount: z.coerce.number().int().nonnegative(),
  effectiveDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

const supportEntryInclude = {
  partner: partnerRefSelect,
};

// GET /api/support-entries?partnerId=  (all partners combined, newest first) -- full history. Backs
// the Monthly Support page and a partner's support section.
//
// A Trip Leader gets no access to financial support detail, even for their own partner.
// requirePartnerQueryScope would let them through (it only checks that partnerId matches), so this
// is an outright role block, like partners.js's directory route.
router.get("/", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.supportEntry.findMany({
      where,
      include: supportEntryInclude,
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/support-entries  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = supportEntrySchema.parse(req.body);
    const created = await prisma.supportEntry.create({ data, include: supportEntryInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/support-entries/:id  (admin only) -- removes a mis-entered row; see the no-PUT note above.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.supportEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });

    await prisma.supportEntry.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
