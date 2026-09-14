const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource. The partner record's own PUT no longer accepts
// a needRequests array, so this router is the only way in -- turning the
// feature off now actually turns it off.
router.use(requireFeature("oneTimeNeeds"));

// The only writer for SupportNeed. Backs both the consolidated "One-Time
// Needs" admin page and the needs section on a single partner's page —
// creating a request against any partner without loading and resubmitting
// their whole record, and recording a decision on one later.
const supportNeedSchema = z.object({
  partnerId: z.string(),
  description: z.string().min(1),
  requestedAmount: z.coerce.number().int().nonnegative(),
  requestDate: z.coerce.date(),
  approvedAmount: z.coerce.number().int().nonnegative().optional().nullable(),
  approvedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const supportNeedInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
};

// GET /api/support-needs?partnerId=  (all partners combined, newest request first)
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.supportNeed.findMany({
      where,
      include: supportNeedInclude,
      orderBy: { requestDate: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/support-needs  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = supportNeedSchema.parse(req.body);
    const created = await prisma.supportNeed.create({ data, include: supportNeedInclude });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    next(err);
  }
});

// PUT /api/support-needs/:id  (update — editor or admin)
// Mainly for recording a decision (approvedAmount/approvedDate) on a
// previously-pending request, but allows editing any field — including
// moving it to a different partner, which is now just a plain column and
// so needs no special handling.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = supportNeedSchema.partial().parse(req.body);
    const updated = await prisma.supportNeed.update({
      where: { id: req.params.id },
      data,
      include: supportNeedInclude,
    });
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

// DELETE /api/support-needs/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.supportNeed.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

module.exports = router;
