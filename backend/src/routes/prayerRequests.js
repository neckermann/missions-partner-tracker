const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole, allowGuestPartnerList } = require("../middleware/requireAuth");
const { readablePartnerIds, isOnCareTeamFor } = require("../utils/guestAccess");
const { requireFeature } = require("../middleware/requireFeature");
const { notifyPrayerRequestCreated, notifyPrayerRequestAnswered } = require("../utils/dispatchRecording");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { logContactForPrayerRequest } = require("../utils/contactLogQueries");
const { getSeenAt, touchSeen, markCategorySeen } = require("../notifications/categories");

// Distinct from the bell's own "newPrayerRequests" NotificationSeen row --
// see categories.js's own comment on touchSeen for why this needs its own
// key. "Since your last visit to this list," not per-item persistent
// state -- next visit clears every highlight from this one, same as
// opening the bell clears its own.
const LIST_VIEW_SEEN_KEY = "newPrayerRequests:listView";

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
  // Admin/editor-set at creation -- see dispatchRecording.js's
  // maybeBroadcastUrgent for what this actually triggers. Default
  // false, same convention as isPublic/includeInBooklet above.
  isUrgent: z.boolean().optional(),
  // Not a PrayerRequest column -- stripped out below before the Prisma
  // create. Only meaningful on creation, for a restricted partner: the
  // admin/editor confirming inline that requestText itself (exactly as
  // typed, nothing edited) is safe to send verbatim, same confirmation
  // Pending Notifications' own Approve path already asks for, just
  // without the extra trip there. See dispatchRecording.js's own
  // comment on notifyPrayerRequestCreated for what this actually sets.
  approveNow: z.boolean().optional(),
  status: z.enum(["ongoing", "answered", "untracked"]).optional(),
  dateAnswered: z.coerce.date().optional().nullable(),
  answeredNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Set only by ExtractionReviewModal.jsx's scan flow -- see the comment
  // on this column in schema.prisma.
  sourceFileId: z.string().optional().nullable(),
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
  // Extends partnerRefSelect's own fields with `archived` -- needed so the
  // admin list page can hide a request for an archived partner by default,
  // the same convention the matching report (reports/prayerRequests.js)
  // already applies server-side. Done locally rather than adding `archived`
  // to the shared constant itself, since partnerRefSelect also backs
  // several files (dispatchRecording.js, supportEntries.js, etc.) that have
  // no use for it.
  partner: { select: { ...partnerRefSelect.select, archived: true } },
  // Just enough for the "From: <title>, <date>" admin card link -- never
  // the file bytes themselves, same omit discipline as every other
  // PartnerFile list query. `kind` is what tells SourceLink.jsx (and the
  // notification payload, see utils/notifications.js) whether to build a
  // /api/partner-files download link.
  sourceFile: { select: { id: true, kind: true, title: true, fileName: true, receivedDate: true } },
};

// GET /api/prayer-requests?partnerId=&from=&to=  (all partners combined, newest received first)
// from/to mirror reports/prayerRequests.js's own date-range filtering --
// same Prisma where-clause shape, now also usable from the live list page's
// FilterBar, not just the read-only Report.
router.get("/", allowGuestPartnerList, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    // A guest browsing without naming a partner sees only the partners they
    // reach (#289) -- the server is the boundary, not the page.
    const reachable = readablePartnerIds(req.user);
    if (reachable && !req.query.partnerId) where.partnerId = { in: reachable };
    if (req.query.from || req.query.to) {
      where.dateReceived = {};
      if (req.query.from) where.dateReceived.gte = new Date(String(req.query.from));
      if (req.query.to) where.dateReceived.lte = new Date(String(req.query.to));
    }

    const records = await prisma.prayerRequest.findMany({
      where,
      include: prayerRequestInclude,
      // createdAt as a tiebreaker: the admin partner page now shows only
      // the first few of these by default (see useLoadMore.js), so two
      // requests received on the same date need a deterministic order --
      // otherwise which one lands in the visible slice isn't guaranteed.
      orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
    });

    // Only the real consolidated list view (no partnerId filter) counts
    // as "visiting the list" -- a single partner's own embedded prayer
    // section hitting this same route shouldn't advance (or read) this
    // timestamp, since that's a different view entirely.
    if (req.query.partnerId) return res.json(records);
    const seenAt = await getSeenAt(req.user.id, LIST_VIEW_SEEN_KEY);
    const annotated = records.map((r) => ({
      ...r,
      isNew: !seenAt || new Date(r.createdAt) > seenAt,
    }));
    await touchSeen(req.user.id, LIST_VIEW_SEEN_KEY);
    // Visiting the real list is also "having seen" the bell/nav-badge
    // category itself -- without this, the badge only clears by opening
    // the bell first, not by navigating here directly (e.g. via the
    // sidebar nav link), which is the whole point of a nav badge.
    await markCategorySeen(req.user.id, "newPrayerRequests");
    res.json(annotated);
  } catch (err) {
    next(err);
  }
});

// A care team member who isn't staff (#289) has what an editor has on their own
// partner -- every field, including the public/booklet toggles -- except what
// would send something out ahead of review: isUrgent and approveNow are
// dropped (their dispatch is always held for staff review instead), and
// deleting stays admin-only. Anything else in the body is applied as for an
// editor.
const careTeamPrayerCreateSchema = prayerRequestSchema.omit({ isUrgent: true, approveNow: true });
const careTeamPrayerUpdateSchema = prayerRequestSchema.omit({ isUrgent: true, approveNow: true }).partial();

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
    const created = await prisma.prayerRequest.create({
      data,
      include: prayerRequestInclude,
    });

    // Best-effort: notifyPrayerRequestCreated (utils/dispatchRecording.js)
    // never throws -- a broken notification channel must never block
    // saving the request itself. A care team member's is always held for
    // staff review (requireReview) and can never be urgent or pre-approved.
    await notifyPrayerRequestCreated(created, approveNow ? { reviewerId: req.user.id } : null, {
      requireReview: !staff,
    });
    // #288: what a care team member just heard from the partner is also a
    // contact. (Staff entering a request on someone's behalf didn't
    // necessarily speak to them, so they log one themselves if they did.)
    if (!staff) await logContactForPrayerRequest(created, req.user);

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

    // Same best-effort reasoning as the POST route above.
    if (data.status === "answered" && before?.status !== "answered") {
      await notifyPrayerRequestAnswered(updated, { requireReview: !staff });
      // #292: the partner telling a care team member a prayer was answered is
      // a contact too (inbound), same as a new request above.
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
