const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { partnerRefSelect } = require("../utils/prismaIncludes");

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
  partner: partnerRefSelect,
};

// GET /api/support-entries?partnerId=  (all partners combined, newest
// first) -- full history, not just each partner's current amount. Backs
// both the consolidated Monthly Support page and the support section on a
// single partner's page.
//
// A Trip Leader has no access to financial support detail at all, even
// for their own one linked Partner -- unlike Prayer Requests/Newsletters
// & Docs (ministry content, fine for a trip guest to read), a partner's
// monthly support history is financial detail this role was never meant
// to see. requirePartnerQueryScope (used by those other resources to let
// a Trip Leader through for their own partnerId) would have let this
// through too, since it only checks the partnerId matches, not whether
// the resource itself is theirs to see -- so this uses an outright role
// block instead, same as partners.js's own directory route.
router.get("/", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.supportEntry.findMany({
      where,
      include: supportEntryInclude,
      // createdAt as a tiebreaker -- see the same comment in prayerRequests.js.
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

// DELETE /api/support-entries/:id  (admin only) -- removes a mis-entered
// row (wrong amount/date/partner). Not an "edit"; see the no-PUT comment
// above.
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
