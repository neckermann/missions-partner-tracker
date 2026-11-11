// Channel-neutral entry points for every record-lifecycle event a route
// notifies on: a prayer request/one-time need/newsletter created, or a
// prayer request answered / one-time need decided. Every notifying
// route calls one of these, never a specific channel's notify function.
//
// Every event is recorded, with one exception: a restricted partner's
// event is only recorded if allowRestrictedPartnerDispatch is on
// (see dispatchEligibility.js's isRestrictedPartnerBlocked). Every
// other setting only ever affects delivery, never recording -- see
// isEligibleForChannel, which each channel calls at send time instead.
const prisma = require("../prismaClient");
const { isRestrictedPartnerBlocked, getChurchSettings } = require("./dispatchEligibility");
const { sendUrgentDispatch } = require("./dispatchOrchestrator");

// Every function below is best-effort: a broken write must never block
// the save that triggered it (a corrupted ChurchSettings row, a
// transient DB hiccup -- rare, but the save itself must survive it
// regardless).
async function safeNotify(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed:`, err);
  }
}

// `review`, when given, is { reviewedById, reviewedText } -- the inline
// "approve now" path from the creation form, written in the same
// create call rather than a later PUT. Harmless to pass for a
// non-restricted partner (or a type outside REVIEW_GATED_TYPES) --
// needsReview() simply never looks at dispatchReviewedAt in that case.
async function enqueue(type, partnerId, payload, review) {
  const reviewFields = review
    ? {
        dispatchReviewedAt: new Date(),
        dispatchReviewedById: review.reviewedById,
        dispatchReviewedText: review.reviewedText,
      }
    : {};
  return prisma.dispatchRecord.create({ data: { type, partnerId, payload, ...reviewFields } });
}

// The one place recording still depends on a setting -- restricted-
// partner events only. Re-fetches isRestricted fresh by id rather than
// trusting the caller's partner shape: every call site here only has a
// route's own partnerRefSelect ({ id, kind, displayName }) on hand, not
// a guaranteed isRestricted, and this is the one safety-critical check
// in the system.
async function createDispatchRecord(type, partner, payload, review) {
  const [settings, freshPartner] = await Promise.all([
    getChurchSettings(),
    prisma.partner.findUnique({ where: { id: partner.id }, select: { isRestricted: true } }),
  ]);
  if (isRestrictedPartnerBlocked(freshPartner, settings)) return null;
  return enqueue(type, partner.id, payload, review);
}

// Fires the immediate cross-channel dispatch when isUrgent is set --
// sendUrgentDispatch still calls isEligibleForChannel per channel
// (restricted-partner review, chat-channel mutes, the public email
// dispatch's prayer-only rule all still apply; only each channel's
// cadence/schedule wait is bypassed). Awaited, not fire-and-forget.
async function maybeDispatchUrgent(row, partner, isUrgent) {
  if (!row || !isUrgent) return;
  await sendUrgentDispatch(row, partner);
}

// `approval`, when given, is { reviewerId } -- set when the admin/editor
// checked "Review and approve now" on the creation form instead of
// leaving this for Pending Dispatches later. reviewedText is always
// exactly what they just typed, never an edited version -- a different
// wording still goes through Pending Dispatches' own Edit flow.
async function notifyPrayerRequestCreated(prayerRequest, approval) {
  await safeNotify("Prayer request created", async () => {
    const review = approval
      ? { reviewedById: approval.reviewerId, reviewedText: prayerRequest.requestText }
      : null;
    const row = await createDispatchRecord(
      "prayerRequestCreated",
      prayerRequest.partner,
      {
        partnerName: prayerRequest.partner?.displayName || "A partner",
        requestText: prayerRequest.requestText,
        sourceFileId: prayerRequest.sourceFile?.id || null,
      },
      review
    );
    await maybeDispatchUrgent(row, prayerRequest.partner, prayerRequest.isUrgent);
  });
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await safeNotify("Prayer request answered", async () => {
    await createDispatchRecord("prayerRequestAnswered", prayerRequest.partner, {
      partnerName: prayerRequest.partner?.displayName || "A partner",
      requestText: prayerRequest.requestText,
      answeredNote: prayerRequest.answeredNote || null,
      sourceFileId: prayerRequest.sourceFile?.id || null,
    });
  });
}

// Same inline "approve now" path as notifyPrayerRequestCreated above --
// see that function's own comment.
async function notifySupportNeedCreated(supportNeed, approval) {
  await safeNotify("Support need created", async () => {
    const review = approval
      ? { reviewedById: approval.reviewerId, reviewedText: supportNeed.description }
      : null;
    const row = await createDispatchRecord(
      "supportNeedCreated",
      supportNeed.partner,
      {
        partnerName: supportNeed.partner?.displayName || "A partner",
        description: supportNeed.description,
        // One-time needs never reach the public email dispatch (not in
        // dispatchBlurbs.js's PUBLIC_EMAIL_DISPATCH_TYPES) -- admin-only, so
        // the requested amount is safe to surface in the dispatch
        // itself rather than requiring a trip to the One-Time Needs page.
        requestedAmount: supportNeed.requestedAmount,
        sourceFileId: supportNeed.sourceFile?.id || null,
      },
      review
    );
    await maybeDispatchUrgent(row, supportNeed.partner, supportNeed.isUrgent);
  });
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", async () => {
    await createDispatchRecord("supportNeedDecided", supportNeed.partner, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      approvedAmount: supportNeed.approvedAmount,
      requestedAmount: supportNeed.requestedAmount,
      // Admin-only, same reasoning as requestedAmount above -- documents
      // why the decision came out the way it did.
      decisionNote: supportNeed.decisionNote || null,
      sourceFileId: supportNeed.sourceFile?.id || null,
    });
  });
}

async function notifyNewsletterCreated(newsletter) {
  await safeNotify("Newsletter created", async () => {
    await createDispatchRecord("newsletterCreated", newsletter.partner, {
      partnerName: newsletter.partner?.displayName || "A partner",
      newsletterId: newsletter.id,
      title: newsletter.title || null,
    });
  });
}

module.exports = {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
