const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource. The partner record's own PUT no longer accepts
// a supportEntries array, so this router is the only way in -- turning the
// feature off now actually turns it off.
router.use(requireFeature("monthlySupport"));

// The only writer for SupportEntry. The partner record's own PUT no longer
// accepts a supportEntries array -- see the comment on PUT /api/partners/:id.
//
// Deliberately no PUT/edit here either: a support entry is a point-in-time
// record of what the monthly amount was set to as of effectiveDate, same as
// a real financial ledger. Correcting a mistake means deleting the bad entry
// and adding a new one, not silently rewriting history -- "current support"
// is always just whichever entry has the latest effectiveDate.
const supportEntrySchema = z.object({
  partnerId: z.string(),
  amount: z.coerce.number().int().nonnegative(),
  effectiveDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

const supportEntryInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
};

// GET /api/support-entries?partnerId=  (all partners combined, newest
// first) -- full history, not just each partner's current amount. Backs
// both the consolidated Monthly Support page and the support section on a
// single partner's page.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.supportEntry.findMany({
      where,
      include: supportEntryInclude,
      orderBy: { effectiveDate: "desc" },
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
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    next(err);
  }
});

// DELETE /api/support-entries/:id  (admin only) -- removes a mis-entered
// row (wrong amount/date/partner). Not an "edit"; see the no-PUT comment
// above.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.supportEntry.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    await prisma.supportEntry.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
