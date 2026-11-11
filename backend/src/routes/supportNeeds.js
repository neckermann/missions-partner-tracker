const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { notifySupportNeedCreated, notifySupportNeedDecided } = require("../utils/dispatchRecording");
const { partnerRefSelect } = require("../utils/prismaIncludes");

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
  decisionNote: z.string().optional().nullable(),
  // Admin/editor-set at creation -- see dispatchRecording.js's
  // maybeBroadcastUrgent for what this actually triggers.
  isUrgent: z.boolean().optional(),
  // Not a SupportNeed column -- stripped out below before the Prisma
  // create. Same inline "approve now" path as prayerRequests.js's own
  // approveNow -- see that file's comment.
  approveNow: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  // Set only by ExtractionReviewModal.jsx's scan flow -- see the comment
  // on this column in schema.prisma.
  sourceFileId: z.string().optional().nullable(),
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
  partner: partnerRefSelect,
  // Just enough for the "From: <title>, <date>" admin card link -- never
  // the file bytes themselves, same omit discipline as every other
  // PartnerFile list query. `kind` is what tells SourceLink.jsx (and the
  // notification payload, see utils/notifications.js) whether to build a
  // /api/partner-files download link.
  sourceFile: { select: { id: true, kind: true, title: true, fileName: true, receivedDate: true } },
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
    const { approveNow, ...data } = supportNeedSchema
      .refine(approvedPairGiven, APPROVED_PAIR_ISSUE)
      .parse(req.body);
    const created = await prisma.supportNeed.create({ data, include: supportNeedInclude });

    // Best-effort: notifySupportNeedCreated (utils/dispatchRecording.js)
    // never throws -- see the same comment in routes/prayerRequests.js.
    await notifySupportNeedCreated(created, approveNow ? { reviewerId: req.user.id } : null);

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

    // Only notify on a genuine transition into having a decision recorded
    // (see #127) -- approvedPairGiven already guarantees approvedDate is
    // only ever sent alongside approvedAmount, so checking approvedDate
    // here covers both. A PUT that doesn't touch the pair never fetches
    // `before`; one that resends the same decision (before.approvedDate
    // already set) is caught by the before?.approvedDate check rather
    // than re-notifying; one that clears a decision (both sent as null)
    // is excluded by data.approvedDate != null.
    const before =
      "approvedDate" in data
        ? await prisma.supportNeed.findUnique({
            where: { id: req.params.id },
            select: { approvedDate: true },
          })
        : null;

    const updated = await prisma.supportNeed.update({
      where: { id: req.params.id },
      data,
      include: supportNeedInclude,
    });

    // Same best-effort reasoning as the POST route above.
    if (data.approvedDate != null && before?.approvedDate == null) {
      await notifySupportNeedDecided(updated);
    }

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
