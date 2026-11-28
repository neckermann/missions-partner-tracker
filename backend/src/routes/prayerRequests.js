const express = require("express");
const { withSendingChurch } = require("../utils/sendingChurch");

const { z } = require("zod");
const prisma = require("../prismaClient");
const { sourceFileProblem } = require("../utils/sourceFile");
const { requireAuth, requireRole, allowGuestPartnerList } = require("../middleware/requireAuth");
const { readablePartnerIds, isOnCareTeamFor } = require("../utils/guestAccess");
const { requireFeature } = require("../middleware/requireFeature");
const {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  discardQueuedForEverydayPrayer,
} = require("../utils/dispatchRecording");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { logContactForPrayerRequest } = require("../utils/contactLogQueries");
const { getSeenAt, touchSeen, markCategorySeen } = require("../notifications/categories");

// Distinct from the bell's "newPrayerRequests" NotificationSeen row (see touchSeen in
// categories.js): "since your last visit to this list", cleared by the next visit.
const LIST_VIEW_SEEN_KEY = "newPrayerRequests:listView";

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("prayerRequests"));

// The only writer for PrayerRequest, same shape as routes/supportNeeds.js. `status` has no
// "unanswered" value on purpose (see schema.prisma): "ongoing" is the neutral default.
const prayerRequestSchema = z.object({
  partnerId: z.string(),
  category: z.enum(["strategic", "situational"]),
  requestText: z.string().min(1),
  dateReceived: z.coerce.date(),
  isPublic: z.boolean().optional(),
  includeInBooklet: z.boolean().optional(),
  // Admin/editor-set at creation; see maybeBroadcastUrgent in dispatchRecording.js.
  isUrgent: z.boolean().optional(),
  // Not a PrayerRequest column (stripped before create). On creation for a restricted partner: the
  // admin/editor confirming requestText, exactly as typed, is safe to send verbatim (see
  // notifyPrayerRequestCreated in dispatchRecording.js).
  approveNow: z.boolean().optional(),
  status: z.enum(["ongoing", "answered", "untracked"]).optional(),
  dateAnswered: z.coerce.date().optional().nullable(),
  answeredNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Set only by ExtractionReviewModal.jsx's scan flow (see schema.prisma).
  sourceFileId: z.string().optional().nullable(),
});

// Fires only when a request transitions to "answered" in this request: it must carry a real
// dateAnswered. A partial PUT on an already-answered record is unaffected.
function answeredDateGiven(data) {
  if (data.status !== "answered") return true;
  return data.dateAnswered != null;
}
const ANSWERED_DATE_ISSUE = {
  message: 'dateAnswered is required when status is "answered"',
  path: ["dateAnswered"],
};

const prayerRequestInclude = {
  // Extends partnerRefSelect with `archived` so the list can hide archived partners' requests by
  // default; local because other users of partnerRefSelect have no use for it.
  partner: { select: { ...partnerRefSelect.select, archived: true } },
  // Just enough for the "From: <title>, <date>" link (never file bytes); `kind` tells SourceLink.jsx
  // and the notification payload whether to build a /api/partner-files download link.
  sourceFile: { select: { id: true, kind: true, title: true, fileName: true, receivedDate: true } },
};

// GET /api/prayer-requests?partnerId=&from=&to=  (all partners combined, newest received first)
// from/to mirror the date filtering in reports/prayerRequests.js.
router.get("/", allowGuestPartnerList, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    // A guest without a named partner sees only the partners they reach (#289): the server is the boundary.
    const reachable = readablePartnerIds(req.user);
    if (reachable && !req.query.partnerId) where.partnerId = { in: reachable };
    if (req.query.from || req.query.to) {
      where.dateReceived = {};
      if (req.query.from) where.dateReceived.gte = new Date(String(req.query.from));
      if (req.query.to) where.dateReceived.lte = new Date(String(req.query.to));
    }
    withSendingChurch(where, req.query.sendingChurch);

    const records = await prisma.prayerRequest.findMany({
      where,
      include: prayerRequestInclude,
      // createdAt tiebreaker: same-date requests need a deterministic order for the load-more slice.
      orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
    });

    // Only the consolidated list view (no partnerId) counts as visiting the list, not a partner's
    // embedded section.
    if (req.query.partnerId) return res.json(records);
    const seenAt = await getSeenAt(req.user.id, LIST_VIEW_SEEN_KEY);
    const annotated = records.map((r) => ({
      ...r,
      isNew: !seenAt || new Date(r.createdAt) > seenAt,
    }));
    await touchSeen(req.user.id, LIST_VIEW_SEEN_KEY);
    // Visiting the list also clears the nav-badge category, so the badge clears without opening the
    // bell first.
    await markCategorySeen(req.user.id, "newPrayerRequests");
    res.json(annotated);
  } catch (err) {
    next(err);
  }
});

// A care team member who isn't staff (#289) -- a limited guest, or a viewer who can write only because they
// sit on this partner's care team -- has what an editor has on their own partner, except whatever would put
// something in front of people ahead of review. isUrgent and approveNow are dropped (their dispatch is always
// held for staff review instead), and so are isPublic and includeInBooklet: the public profile and the
// printed Sunday sheet read those two flags with no review check of their own, so only staff may set them.
// They are removed from the body, not defaulted: a request they edit keeps whatever staff chose. Deleting
// stays admin-only. Anything else in the body is applied as for an editor.
const NEEDS_STAFF = { isUrgent: true, approveNow: true, isPublic: true, includeInBooklet: true };
const careTeamPrayerCreateSchema = prayerRequestSchema.omit(NEEDS_STAFF);
const careTeamPrayerUpdateSchema = prayerRequestSchema.omit(NEEDS_STAFF).partial();

const isStaff = (user) => user.role === "admin" || user.role === "editor";
const FORBIDDEN = { error: "Insufficient permissions" };

// POST /api/prayer-requests  (create — editor or admin, or a care team
// member for their own partner, held for staff review)
router.post("/", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const staff = isStaff(req.user);
    const { approveNow, ...data } = staff
      ? prayerRequestSchema.refine(answeredDateGiven, ANSWERED_DATE_ISSUE).parse(req.body)
      : careTeamPrayerCreateSchema.parse(req.body);
    if (!staff && !(await isOnCareTeamFor(req.user, data.partnerId))) {
      return res.status(403).json(FORBIDDEN);
    }
    {
      const problem = await sourceFileProblem(data.sourceFileId, data.partnerId);
      if (problem) return res.status(400).json({ error: problem });
    }
    const created = await prisma.prayerRequest.create({
      data,
      include: prayerRequestInclude,
    });

    // Best-effort: notifyPrayerRequestCreated (utils/dispatchRecording.js) never throws. A care team
    // member's is held for staff review (requireReview) and can never be urgent or pre-approved.
    await notifyPrayerRequestCreated(created, approveNow ? { reviewerId: req.user.id } : null, {
      requireReview: !staff,
    });
    // What a care team member just heard from the partner is also a contact (staff log their own).
    if (!staff) await logContactForPrayerRequest(created, req.user);

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/prayer-requests/:id  (update — editor or admin)
// Mainly for recording an answer; any field is editable, including moving to another partner.
router.put("/:id", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const staff = isStaff(req.user);
    if (!staff) {
      // A care team member edits their own partner's request -- and may only
      // move it to another partner whose team they are also on.
      const existing = await prisma.prayerRequest.findUnique({
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
    const data = (staff ? prayerRequestSchema.partial() : careTeamPrayerUpdateSchema)
      .refine(answeredDateGiven, ANSWERED_DATE_ISSUE)
      .parse(req.body);

    // A care team member's edit to something staff already put on the public sheet or booklet would go out
    // unreviewed, so it is taken off until staff look at it and tick it again. Only changes to what is printed
    // count: notes and the source link do not.
    if (!staff) {
      const live = await prisma.prayerRequest.findUnique({
        where: { id: req.params.id },
        select: {
          isPublic: true,
          includeInBooklet: true,
          partnerId: true,
          category: true,
          requestText: true,
          status: true,
          answeredNote: true,
        },
      });
      const printed = ["partnerId", "category", "requestText", "status", "answeredNote"];
      if (
        live &&
        (live.isPublic || live.includeInBooklet) &&
        printed.some((k) => k in data && data[k] !== live[k])
      ) {
        data.isPublic = false;
        data.includeInBooklet = false;
      }
    }

    // Notify only on a genuine transition into "answered"; the before?.status check below stops a
    // re-sent status from re-notifying.
    const before =
      data.status === "answered"
        ? await prisma.prayerRequest.findUnique({ where: { id: req.params.id }, select: { status: true } })
        : null;

    if (data.sourceFileId) {
      const current = await prisma.prayerRequest.findUnique({
        where: { id: req.params.id },
        select: { partnerId: true },
      });
      const problem = await sourceFileProblem(data.sourceFileId, data.partnerId ?? current?.partnerId);
      if (problem) return res.status(400).json({ error: problem });
    }
    const updated = await prisma.prayerRequest.update({
      where: { id: req.params.id },
      data,
      include: prayerRequestInclude,
    });

    // Moved to "Everyday" (staff only): anything still queued from when it was Ministry must not go out. Done
    // whatever else changed, and not best-effort: if it fails the save fails, rather than leave it queued.
    if (updated.category === "situational") await discardQueuedForEverydayPrayer(updated.id);

    // Same best-effort reasoning as the POST route above.
    if (data.status === "answered" && before?.status !== "answered") {
      await notifyPrayerRequestAnswered(updated, { requireReview: !staff });
      // The partner telling a care team member a prayer was answered is an inbound contact too.
      if (!staff) await logContactForPrayerRequest(updated, req.user, { answered: true });
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
