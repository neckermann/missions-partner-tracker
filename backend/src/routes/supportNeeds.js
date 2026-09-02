const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Free-standing CRUD for SupportNeed, on top of the wholesale-replace
// `needRequests` array already handled inside routes/missionaries.js and
// routes/organizations.js (used by each entity's own edit form). This is
// the API for the consolidated "One-Time Needs" admin page — creating a
// request against any missionary/org without loading and resubmitting
// their whole record, and recording a decision on one later.
const supportNeedBaseSchema = z.object({
  missionaryId: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  description: z.string().min(1),
  requestedAmount: z.coerce.number().int().nonnegative(),
  requestDate: z.coerce.date(),
  approvedAmount: z.coerce.number().int().nonnegative().optional().nullable(),
  approvedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const createSupportNeedSchema = supportNeedBaseSchema.refine(
  (data) => Boolean(data.missionaryId) !== Boolean(data.organizationId),
  { message: "Exactly one of missionaryId or organizationId is required", path: ["missionaryId"] }
);

const supportNeedInclude = {
  missionary: { select: { id: true, displayName: true } },
  organization: { select: { id: true, name: true } },
};

// GET /api/support-needs  (all entities combined, newest request first)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.supportNeed.findMany({
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
    const data = createSupportNeedSchema.parse(req.body);
    const created = await prisma.supportNeed.create({ data, include: supportNeedInclude });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PUT /api/support-needs/:id  (update — editor or admin)
// Mainly for recording a decision (approvedAmount/approvedDate) on a
// previously-pending request, but allows editing any field. Doesn't accept
// re-parenting to a different missionary/organization from this endpoint —
// only the fields below are ever applied.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { missionaryId, organizationId, ...rest } = supportNeedBaseSchema.partial().parse(req.body);
    const updated = await prisma.supportNeed.update({
      where: { id: req.params.id },
      data: rest,
      include: supportNeedInclude,
    });
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// DELETE /api/support-needs/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.supportNeed.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
