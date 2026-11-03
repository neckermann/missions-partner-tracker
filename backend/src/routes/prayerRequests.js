const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { notifyPrayerRequestCreated, notifyPrayerRequestAnswered } = require("../utils/notifications");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
router.use(requireFeature("prayerRequests"));

// The only writer for PrayerRequest, same shape as routes/supportNeeds.js.
// Backs both the consolidated "Prayer Requests" admin page and the prayer
// section on a single partner's page. `status` has no "unanswered" value on
// purpose (see the PrayerRequest model comment in schema.prisma) --
// "ongoing" is the neutral default, not a flag that something failed to
// happen.
const prayerRequestSchema = z.object({
  partnerId: z.string(),
  category: z.enum(["strategic", "situational"]),
  requestText: z.string().min(1),
  dateReceived: z.coerce.date(),
  isPublic: z.boolean().optional(),
  includeInBooklet: z.boolean().optional(),
  status: z.enum(["ongoing", "answered", "untracked"]).optional(),
  dateAnswered: z.coerce.date().optional().nullable(),
  answeredNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Set only by ExtractionReviewModal.jsx's scan flow -- see the comment on
  // these columns in schema.prisma. At most one of the two is ever sent.
  sourceNewsletterId: z.string().optional().nullable(),
  sourceDocumentId: z.string().optional().nullable(),
});

// Only fires when a request transitions to "answered" *in this request* --
// the schema.prisma model comment pairs status/dateAnswered/answeredNote
// deliberately ("this is what lets a church look back... and see how
// prayers were actually answered"), but nothing enforced it. Doesn't look
// at what's already stored, so a partial PUT touching some other field
// while status happens to already be "answered" from an earlier save is
// unaffected -- this only catches a request that sets status to
// "answered" without also providing a real date in that same request.
function answeredDateGiven(data) {
  if (data.status !== "answered") return true;
  return data.dateAnswered != null;
}
const ANSWERED_DATE_ISSUE = {
  message: 'dateAnswered is required when status is "answered"',
  path: ["dateAnswered"],
};

const prayerRequestInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
  // Just enough for the "From: <title>, <date>" admin card link -- never
  // the file bytes themselves, same omit discipline as every other
  // Newsletter/Document list query.
  sourceNewsletter: { select: { id: true, title: true, fileName: true, receivedDate: true } },
  sourceDocument: { select: { id: true, title: true, fileName: true, receivedDate: true } },
};

// GET /api/prayer-requests?partnerId=  (all partners combined, newest received first)
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.prayerRequest.findMany({
      where,
      include: prayerRequestInclude,
      // createdAt as a tiebreaker: the admin partner page now shows only
      // the first few of these by default (see useLoadMore.js), so two
      // requests received on the same date need a deterministic order --
      // otherwise which one lands in the visible slice isn't guaranteed.
      orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/prayer-requests  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = prayerRequestSchema.refine(answeredDateGiven, ANSWERED_DATE_ISSUE).parse(req.body);
    const created = await prisma.prayerRequest.create({
      data,
      include: prayerRequestInclude,
    });

    // Best-effort: a broken notification channel (today GroupMe, maybe
    // others later) must never block saving the request itself.
    // notifyPrayerRequestCreated already catches its own network/API
    // errors and logs them; this is a second layer in case something
    // else in there throws (e.g. a malformed stored token failing
    // decryptField).
    try {
      await notifyPrayerRequestCreated(created);
    } catch (err) {
      console.error("Prayer request created notification failed:", err);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/prayer-requests/:id  (update — editor or admin)
// Mainly for recording an answer (status/dateAnswered/answeredNote) on a
// previously-ongoing request, but allows editing any field — including
// moving it to a different partner, which is now just a plain column and so
// needs no special handling.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = prayerRequestSchema.partial().refine(answeredDateGiven, ANSWERED_DATE_ISSUE).parse(req.body);

    // Only notify on a genuine transition into "answered" (see #127) -- a
    // PUT that doesn't touch status at all never fetches `before`, and one
    // that sets status: "answered" while it's already "answered" (e.g. a
    // typo fix to answeredNote re-sending the same status) is caught by
    // the before?.status check below rather than re-notifying.
    const before =
      data.status === "answered"
        ? await prisma.prayerRequest.findUnique({ where: { id: req.params.id }, select: { status: true } })
        : null;

    const updated = await prisma.prayerRequest.update({
      where: { id: req.params.id },
      data,
      include: prayerRequestInclude,
    });

    if (data.status === "answered" && before?.status !== "answered") {
      // Same best-effort reasoning as the POST route above -- a broken
      // channel (today GroupMe, maybe others later) must never block
      // recording the answer itself.
      try {
        await notifyPrayerRequestAnswered(updated);
      } catch (err) {
        console.error("Prayer request answered notification failed:", err);
      }
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/prayer-requests/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.prayerRequest.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
