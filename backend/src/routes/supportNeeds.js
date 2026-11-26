const express = require("express");
const { withSendingChurch } = require("../utils/sendingChurch");

const { z } = require("zod");
const prisma = require("../prismaClient");
const { sourceFileProblem } = require("../utils/sourceFile");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { readableNeedPartnerIds, isOnCareTeamFor } = require("../utils/guestAccess");
const { requireFeature } = require("../middleware/requireFeature");
const { notifySupportNeedCreated, notifySupportNeedDecided } = require("../utils/dispatchRecording");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { getSeenAt, touchSeen, markCategorySeen } = require("../notifications/categories");

// Distinct from the bell's "newOneTimeNeeds" row, which opening the bell already advances (see
// LIST_VIEW_SEEN_KEY in prayerRequests.js).
const LIST_VIEW_SEEN_KEY = "newOneTimeNeeds:listView";

const router = express.Router();
router.use(requireAuth);
// Gates the whole resource.
router.use(requireFeature("oneTimeNeeds"));

// The only writer for SupportNeed. Backs the One-Time Needs admin page and a partner's needs section.
const supportNeedSchema = z.object({
  partnerId: z.string(),
  description: z.string().min(1),
  // Optional: a need can be raised with no dollar figure (blank, or null, is stored as 0 = "no amount").
  // On an update an omitted key leaves what is stored.
  requestedAmount: z
    .preprocess((v) => (v === null || v === "" ? 0 : v), z.coerce.number().int().nonnegative())
    .optional(),
  requestDate: z.coerce.date(),
  approvedAmount: z.coerce.number().int().nonnegative().optional().nullable(),
  approvedDate: z.coerce.date().optional().nullable(),
  decisionNote: z.string().optional().nullable(),
  // Admin/editor-set at creation; see maybeBroadcastUrgent in dispatchRecording.js.
  isUrgent: z.boolean().optional(),
  // Not a SupportNeed column (stripped before create). Inline "approve now", as in prayerRequests.js.
  approveNow: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  // Set only by ExtractionReviewModal.jsx's scan flow (see schema.prisma).
  sourceFileId: z.string().optional().nullable(),
});

// Checks presence in *this request*, not null-ness: PUT uses .partial(), where an omitted key means
// "leave what is stored". Touching only one of the pair is the bug guarded against:
// reports/oneTimeNeeds.js reads `approvedDate` as "decided" and nulls `approvedAmount` without it, so
// an amount without a date would silently vanish from the report.
function approvedPairGiven(data) {
  return "approvedAmount" in data === "approvedDate" in data;
}
const APPROVED_PAIR_ISSUE = {
  message: "approvedAmount and approvedDate must be set together",
  path: ["approvedDate"],
};

const supportNeedInclude = {
  // Extends partnerRefSelect with `archived` (as in prayerRequests.js).
  partner: { select: { ...partnerRefSelect.select, archived: true } },
  // Just enough for the "From: <title>, <date>" link (never file bytes); `kind` tells SourceLink.jsx
  // and the notification payload whether to build a /api/partner-files download link.
  sourceFile: { select: { id: true, kind: true, title: true, fileName: true, receivedDate: true } },
};

// GET /api/support-needs?partnerId=&status=&from=&to=  (all partners combined, newest request first)
// status/from/to mirror reports/oneTimeNeeds.js (status is derived from approvedAmount being
// null/not-null; there is no status column).
//
// A Trip Leader gets no access: this is financial detail, not ministry content. An outright role
// block, not requirePartnerQueryScope (which would let a matching partnerId through), as in
// supportEntries.js.
router.get("/", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    // Needs are a care team view (#289): a guest reads them only for partners
    // whose team they're on -- never for a partner they reach only through a
    // trip grant (the smaller trip leader scope).
    const reachable = readableNeedPartnerIds(req.user);
    if (reachable) {
      if (req.query.partnerId && !reachable.includes(String(req.query.partnerId))) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      if (!req.query.partnerId) where.partnerId = { in: reachable };
    }
    if (req.query.status === "pending") where.approvedAmount = null;
    if (req.query.status === "decided") where.approvedAmount = { not: null };
    if (req.query.from || req.query.to) {
      where.requestDate = {};
      if (req.query.from) where.requestDate.gte = new Date(String(req.query.from));
      if (req.query.to) where.requestDate.lte = new Date(String(req.query.to));
    }
    withSendingChurch(where, req.query.sendingChurch);

    const records = await prisma.supportNeed.findMany({
      where,
      include: supportNeedInclude,
      orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }],
    });

    // Only the consolidated list view counts as visiting the list (see prayerRequests.js).
    if (req.query.partnerId) return res.json(records);
    const seenAt = await getSeenAt(req.user.id, LIST_VIEW_SEEN_KEY);
    const annotated = records.map((r) => ({
      ...r,
      isNew: !seenAt || new Date(r.createdAt) > seenAt,
    }));
    await touchSeen(req.user.id, LIST_VIEW_SEEN_KEY);
    // Visiting the list also clears the nav-badge category, so the badge clears without opening the
    // bell first.
    await markCategorySeen(req.user.id, "newOneTimeNeeds");
    res.json(annotated);
  } catch (err) {
    next(err);
  }
});

// A care team member who isn't staff (#289) has what an editor has on their own
// partner -- every field of the request itself -- except what the committee or
// board decides: approvedAmount/approvedDate/decisionNote are never theirs to
// set, and isUrgent/approveNow are dropped (their dispatch is always held for
// staff review instead). Deleting stays admin-only. Anything else in the body
// is applied as for an editor.
const careTeamNeedOmit = {
  approvedAmount: true,
  approvedDate: true,
  decisionNote: true,
  isUrgent: true,
  approveNow: true,
};
const careTeamNeedCreateSchema = supportNeedSchema.omit(careTeamNeedOmit);
const careTeamNeedUpdateSchema = supportNeedSchema.omit(careTeamNeedOmit).partial();

const isStaff = (user) => user.role === "admin" || user.role === "editor";
const FORBIDDEN = { error: "Insufficient permissions" };

// POST /api/support-needs  (create — editor or admin, or a care team member
// for their own partner, held for staff review)
router.post("/", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const staff = isStaff(req.user);
    const { approveNow, ...data } = staff
      ? supportNeedSchema.refine(approvedPairGiven, APPROVED_PAIR_ISSUE).parse(req.body)
      : careTeamNeedCreateSchema.parse(req.body);
    if (!staff && !(await isOnCareTeamFor(req.user, data.partnerId))) {
      return res.status(403).json(FORBIDDEN);
    }
    {
      const problem = await sourceFileProblem(data.sourceFileId, data.partnerId);
      if (problem) return res.status(400).json({ error: problem });
    }
    const created = await prisma.supportNeed.create({
      data: { ...data, requestedAmount: data.requestedAmount ?? 0 },
      include: supportNeedInclude,
    });

    // Best-effort: notifySupportNeedCreated (utils/dispatchRecording.js) never throws. A care team
    // member's is held for staff review and can never be urgent or pre-approved.
    await notifySupportNeedCreated(created, approveNow ? { reviewerId: req.user.id } : null, {
      requireReview: !staff,
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/support-needs/:id  (update — editor or admin)
// Mainly for recording a decision; any field is editable, including moving to another partner.
router.put("/:id", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const staff = isStaff(req.user);
    if (!staff) {
      // A care team member edits their own partner's request (before or after
      // staff decide it -- the decision fields themselves are never theirs) and
      // may only move it to another partner whose team they are also on.
      const existing = await prisma.supportNeed.findUnique({
        where: { id: req.params.id },
        select: { partnerId: true },
      });
      if (!existing) return res.status(404).json({ error: "Not found" });
      const partnersInvolved = [existing.partnerId, req.body?.partnerId].filter(
        (id) => typeof id === "string"
      );
      for (const id of partnersInvolved) {
        if (!(await isOnCareTeamFor(req.user, id))) return res.status(403).json(FORBIDDEN);
      }
    }
    const data = (
      staff
        ? supportNeedSchema.partial().refine(approvedPairGiven, APPROVED_PAIR_ISSUE)
        : careTeamNeedUpdateSchema
    ).parse(req.body);

    // Notify only on a genuine transition into a recorded decision: approvedPairGiven guarantees
    // approvedDate only arrives with approvedAmount, so checking it covers both. A PUT not touching the
    // pair never fetches `before`; a resent decision is caught by before?.approvedDate; clearing (both
    // null) is excluded by data.approvedDate != null.
    const before =
      "approvedDate" in data
        ? await prisma.supportNeed.findUnique({
            where: { id: req.params.id },
            select: { approvedDate: true },
          })
        : null;

    if (data.sourceFileId) {
      const current = await prisma.supportNeed.findUnique({
        where: { id: req.params.id },
        select: { partnerId: true },
      });
      const problem = await sourceFileProblem(data.sourceFileId, data.partnerId ?? current?.partnerId);
      if (problem) return res.status(400).json({ error: problem });
    }
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
