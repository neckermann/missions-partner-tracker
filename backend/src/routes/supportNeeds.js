const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { notifySupportNeedCreated } = require("../utils/groupme");

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
  // Set only by ExtractionReviewModal.jsx's scan flow -- see the comment on
  // these columns in schema.prisma. At most one of the two is ever sent.
  sourceNewsletterId: z.string().optional().nullable(),
  sourceDocumentId: z.string().optional().nullable(),
});

// Checks presence in *this request*, not null-ness -- PUT uses .partial(),
// where an omitted key means "leave whatever's already stored," not
// "clear it." A request touching neither field (editing something else
// entirely) is fine; one touching only one of the pair is the actual bug
// this guards against: reports/oneTimeNeeds.js reads `approvedDate` as
// its "has this been decided" signal and nulls `approvedAmount` out when
// it's missing, so a request that set the amount but not the date would
// silently lose the recorded amount on the report, with no error telling
// anyone why.
function approvedPairGiven(data) {
  return "approvedAmount" in data === "approvedDate" in data;
}
const APPROVED_PAIR_ISSUE = {
  message: "approvedAmount and approvedDate must be set together",
  path: ["approvedDate"],
};

const supportNeedInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
  // Just enough for the "From: <title>, <date>" admin card link -- never
  // the file bytes themselves, same omit discipline as every other
  // Newsletter/Document list query.
  sourceNewsletter: { select: { id: true, title: true, fileName: true, receivedDate: true } },
  sourceDocument: { select: { id: true, title: true, fileName: true, receivedDate: true } },
};

// GET /api/support-needs?partnerId=  (all partners combined, newest request first)
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.supportNeed.findMany({
      where,
      include: supportNeedInclude,
      // createdAt as a tiebreaker -- see the same comment in prayerRequests.js.
      orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/support-needs  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = supportNeedSchema.refine(approvedPairGiven, APPROVED_PAIR_ISSUE).parse(req.body);
    const created = await prisma.supportNeed.create({ data, include: supportNeedInclude });

    // Best-effort: a GroupMe outage or bad token must never block saving
    // the need itself -- same reasoning and second-layer catch as
    // routes/prayerRequests.js.
    try {
      await notifySupportNeedCreated(created);
    } catch (err) {
      console.error("GroupMe notification failed:", err);
    }

    res.status(201).json(created);
  } catch (err) {
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
    const data = supportNeedSchema.partial().refine(approvedPairGiven, APPROVED_PAIR_ISSUE).parse(req.body);
    const updated = await prisma.supportNeed.update({
      where: { id: req.params.id },
      data,
      include: supportNeedInclude,
    });
    res.json(updated);
  } catch (err) {
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
