// Channel-neutral entry points for every record-lifecycle event a route notifies
// on (prayer request/one-time need/newsletter created, prayer answered, need
// decided). Routes call these, never a channel's notify function.
//
// Every event is recorded except a restricted partner's when
// allowRestrictedPartnerDispatch is off (dispatchEligibility.js
// isRestrictedPartnerBlocked). All other settings affect only delivery, via
// isEligibleForChannel at send time.
const prisma = require("../prismaClient");
const { isRestrictedPartnerBlocked, getChurchSettings } = require("./dispatchEligibility");
const { sendUrgentDispatch } = require("./dispatchOrchestrator");

// Every function here is best-effort: a broken write must never block the save that triggered it.
async function safeNotify(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed:`, err);
  }
}

// `review`, when given, is { reviewedById, reviewedText }: the inline "approve
// now" path, written in the same create. Harmless for a non-restricted partner
// or a type outside REVIEW_GATED_TYPES (needsReview() never reads it then).
async function enqueue(type, partnerId, payload, review, requireReview = false) {
  const reviewFields = review
    ? {
        dispatchReviewedAt: new Date(),
        dispatchReviewedById: review.reviewedById,
        dispatchReviewedText: review.reviewedText,
      }
    : {};
  return prisma.dispatchRecord.create({
    data: { type, partnerId, payload, ...reviewFields, ...(requireReview ? { reviewRequired: true } : {}) },
  });
}

// The one place recording depends on a setting (restricted-partner events only).
// Re-fetches isRestricted by id rather than trusting the caller's partner shape,
// which lacks it; this is the one safety-critical check in the system.
async function createDispatchRecord(type, partner, payload, review, requireReview = false) {
  const [settings, freshPartner] = await Promise.all([
    getChurchSettings(),
    prisma.partner.findUnique({ where: { id: partner.id }, select: { isRestricted: true } }),
  ]);
  if (isRestrictedPartnerBlocked(freshPartner, settings)) return null;
  return enqueue(type, partner.id, payload, review, requireReview);
}

// Fires the immediate dispatch when isUrgent is set. sendUrgentDispatch still
// calls isEligibleForChannel per channel; only the cadence wait is bypassed.
// Awaited, not fire-and-forget.
async function maybeDispatchUrgent(row, partner, isUrgent) {
  if (!row || !isUrgent) return;
  await sendUrgentDispatch(row, partner);
}

// `approval`, when given, is { reviewerId }: the admin/editor checked "Review and
// approve now". reviewedText is exactly what they typed; other wording goes
// through Pending Dispatches' Edit flow.
//
// `options.requireReview` is set for a care team member's submission: the record
// is held for staff review whatever the partner, and inline-approve and urgent
// are ignored; nothing a non-staff login enters sends before staff approve it.
async function notifyPrayerRequestCreated(prayerRequest, approval, { requireReview = false } = {}) {
  await safeNotify("Prayer request created", async () => {
    const review =
      approval && !requireReview
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
      review,
      requireReview
    );
    await maybeDispatchUrgent(row, prayerRequest.partner, !requireReview && prayerRequest.isUrgent);
  });
}

async function notifyPrayerRequestAnswered(prayerRequest, { requireReview = false } = {}) {
  await safeNotify("Prayer request answered", async () => {
    await createDispatchRecord(
      "prayerRequestAnswered",
      prayerRequest.partner,
      {
        partnerName: prayerRequest.partner?.displayName || "A partner",
        requestText: prayerRequest.requestText,
        answeredNote: prayerRequest.answeredNote || null,
        sourceFileId: prayerRequest.sourceFile?.id || null,
      },
      null,
      requireReview
    );
  });
}

// Same inline "approve now" path as notifyPrayerRequestCreated.
async function notifySupportNeedCreated(supportNeed, approval, { requireReview = false } = {}) {
  await safeNotify("Support need created", async () => {
    const review =
      approval && !requireReview
        ? { reviewedById: approval.reviewerId, reviewedText: supportNeed.description }
        : null;
    const row = await createDispatchRecord(
      "supportNeedCreated",
      supportNeed.partner,
      {
        partnerName: supportNeed.partner?.displayName || "A partner",
        description: supportNeed.description,
        // One-time needs never reach the public email dispatch (not in
        // PUBLIC_EMAIL_DISPATCH_TYPES), so the requested amount is safe to include.
        requestedAmount: supportNeed.requestedAmount,
        sourceFileId: supportNeed.sourceFile?.id || null,
      },
      review,
      requireReview
    );
    await maybeDispatchUrgent(row, supportNeed.partner, !requireReview && supportNeed.isUrgent);
  });
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", async () => {
    await createDispatchRecord("supportNeedDecided", supportNeed.partner, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      approvedAmount: supportNeed.approvedAmount,
      requestedAmount: supportNeed.requestedAmount,
      // Admin-only, like requestedAmount: why the decision came out this way.
      decisionNote: supportNeed.decisionNote || null,
      sourceFileId: supportNeed.sourceFile?.id || null,
    });
  });
}

// `options.requireReview`: a care team member's upload is held for staff review like their requests.
async function notifyNewsletterCreated(newsletter, { requireReview = false } = {}) {
  await safeNotify("Newsletter created", async () => {
    await createDispatchRecord(
      "newsletterCreated",
      newsletter.partner,
      {
        partnerName: newsletter.partner?.displayName || "A partner",
        newsletterId: newsletter.id,
        title: newsletter.title || null,
      },
      null,
      requireReview
    );
  });
}

module.exports = {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
