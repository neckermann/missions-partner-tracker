const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Only gates this standalone CRUD path -- doesn't reach the nested
// supportEntries array inside routes/missionaries.js/organizations.js,
// which stays usable from a missionary/org's own edit form either way. Same
// narrower-gap situation as routes/supportNeeds.js and routes/trips.js.
router.use(requireFeature("monthlySupport"));

// Free-standing create/delete for SupportEntry, on top of the
// wholesale-replace `supportEntries` array already handled inside
// routes/missionaries.js and routes/organizations.js (used by each entity's
// own edit form). This is the API for the consolidated "Monthly Support"
// admin page -- logging a new support amount against any missionary/org
// without loading and resubmitting their whole record.
//
// Deliberately no PUT/edit here: a support entry is a point-in-time record
// of what the monthly amount was set to as of effectiveDate, same as a
// real financial ledger. Correcting a mistake means deleting the bad entry
// and adding a new one, not silently rewriting history -- "current
// support" is always just whichever entry has the latest effectiveDate
// (see the schema.prisma comment on supportEntrySchema in missionaries.js).
const supportEntrySchema = z
  .object({
    missionaryId: z.string().optional().nullable(),
    organizationId: z.string().optional().nullable(),
    amount: z.coerce.number().int().nonnegative(),
    effectiveDate: z.coerce.date(),
    notes: z.string().optional().nullable(),
  })
  .refine((data) => Boolean(data.missionaryId) !== Boolean(data.organizationId), {
    message: "Exactly one of missionaryId or organizationId is required",
    path: ["missionaryId"],
  });

const supportEntryInclude = {
  missionary: { select: { id: true, displayName: true } },
  organization: { select: { id: true, name: true } },
};

// GET /api/support-entries  (all entities combined, newest first) -- full
// history, not just each partner's current amount (the top-level page
// already gets "current" for free via each entity's own supportEntries
// relation, ordered desc; this is for showing/deleting individual entries).
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.missionaryId) where.missionaryId = String(req.query.missionaryId);
    if (req.query.organizationId) where.organizationId = String(req.query.organizationId);

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
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
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
