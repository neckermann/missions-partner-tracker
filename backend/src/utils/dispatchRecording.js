// Channel-neutral entry points for every record-lifecycle event a route notifies
// on (prayer request/one-time need/newsletter created, prayer answered, need
// decided). Routes call these, never a channel's notify function.
//
// Every event is recorded (while some channel is on) except a restricted partner's when
// allowRestrictedPartnerDispatch is off (dispatchEligibility.js
// isRestrictedPartnerBlocked). All other settings affect only delivery, via
// isEligibleForChannel at send time.
const prisma = require("../prismaClient");
const {
  CHANNELS,
  isRestrictedPartnerBlocked,
  needsReview,
  isEligibleForChannel,
  getChurchSettings,
} = require("./dispatchEligibility");
const { hasWhatsAppTarget } = require("./whatsappChannel");
const { isFeatureEnabled } = require("./features");
const { sendUrgentDispatch } = require("./dispatchOrchestrator");
const { isEverydayPrayer } = require("./dispatchBlurbs");

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
//
// It also records nothing when no channel that is switched on would ever take this event: GroupMe and
// WhatsApp only count when their own content-type choice lets this type through, and email only when it is on
// and the type is one email carries. Otherwise the row could only sit there and post, all at once, when
// someone later changes a setting. Two things are always recorded: a row held for staff review (it must show up
// to be approved), and an urgent one (`options.urgent`: its immediate send does not wait on a schedule).
async function createDispatchRecord(type, partner, payload, review, requireReview = false, options = {}) {
  // An "Everyday" prayer request is staff only: no record is made for it, so there is nothing to send, queue
  // or show for review. (The payload carries the category so every send path can refuse it as well.)
  if (isEverydayPrayer({ payload })) return null;
  const [settings, freshPartner] = await Promise.all([
    getChurchSettings(),
    prisma.partner.findUnique({ where: { id: partner.id }, select: { isRestricted: true, isPublic: true } }),
  ]);
  if (isRestrictedPartnerBlocked(freshPartner, settings)) return null;
  const features = settings?.enabledFeatures;
  if (!["groupme", "whatsapp", "outboundEmail"].some((f) => isFeatureEnabled(features, f))) return null;

  const wouldBe = {
    type,
    payload,
    reviewRequired: requireReview,
    dispatchReviewedAt: review ? new Date() : null,
  };
  const held = needsReview(wouldBe, freshPartner);
  if (!options.urgent && !held && !anyEnabledChannelWouldTake(wouldBe, freshPartner, settings)) return null;
  return enqueue(type, partner.id, payload, review, requireReview);
}

// True when at least one switched-on channel is allowed to carry this kind of event. Recipients and schedules
// are not considered (those can change before a send); only what the church has turned on and which kinds of
// post each channel is set to carry.
function anyEnabledChannelWouldTake(row, partner, settings) {
  const features = settings?.enabledFeatures;
  const takes = (channel) => isEligibleForChannel(row, channel, partner, settings, true);
  if (isFeatureEnabled(features, "groupme") && takes(CHANNELS.GROUPME)) return true;
  if (
    isFeatureEnabled(features, "whatsapp") &&
    hasWhatsAppTarget(row, settings) &&
    takes(CHANNELS.WHATSAPP)
  ) {
    return true;
  }
  if (isFeatureEnabled(features, "outboundEmail")) {
    if (takes(CHANNELS.EMAIL_ADMIN)) return true;
    if (isFeatureEnabled(features, "publicPrayerDigest") && takes(CHANNELS.EMAIL_PUBLIC)) return true;
  }
  return false;
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
        // Read by every send path (isEverydayPrayer), and by the edit route to find what is queued for it.
        category: prayerRequest.category,
        prayerRequestId: prayerRequest.id,
      },
      review,
      requireReview,
      { urgent: !requireReview && prayerRequest.isUrgent }
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
        category: prayerRequest.category,
        prayerRequestId: prayerRequest.id,
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
      requireReview,
      { urgent: !requireReview && supportNeed.isUrgent }
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

// A request edited to "Everyday" while something about it is still queued: the queued record must not go out.
// Deleting it also takes it off the review queue. Best-effort like the notifiers, but loud, because a failure
// here leaves a staff-only request waiting to be sent (the channels still refuse it by its payload category
// only if that was "situational", which a record made while it was Ministry does not carry).
async function discardQueuedForEverydayPrayer(prayerRequestId) {
  await prisma.dispatchRecord.deleteMany({
    where: {
      type: { in: ["prayerRequestCreated", "prayerRequestAnswered"] },
      payload: { path: ["prayerRequestId"], equals: prayerRequestId },
    },
  });
}

module.exports = {
  discardQueuedForEverydayPrayer,
  createDispatchRecord,
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
