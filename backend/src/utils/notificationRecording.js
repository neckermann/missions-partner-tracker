// Channel-neutral entry points for every record-lifecycle event a route
// notifies on: a prayer request, one-time need, or newsletter being
// created, plus a prayer request getting answered or a one-time need
// getting a funding decision. Every route that notifies on an event
// calls one of the functions below, never a specific channel's notify
// function directly.
//
// Renamed from notifications.js for consistency -- every other
// notification*.js file now names what it specifically does
// (Eligibility, Blurbs, Orchestrator); a bare "notifications.js" stood
// out as the one generically-named file in a group that otherwise names
// its own narrow job.
//
// Every event is recorded, with exactly one exception: a restricted
// partner's event is only recorded at all if the church has
// allowRestrictedPartnerNotifications on (see
// notificationEligibility.js's isRestrictedPartnerBlocked). Every other
// setting -- GroupMe's content-type mutes, cadence tiers, anything else
// -- only ever affects delivery, never recording; see
// notificationEligibility.js's isEligibleForChannel, which each channel
// calls at send time instead.
const prisma = require("../prismaClient");
const { isRestrictedPartnerBlocked, getChurchSettings } = require("./notificationEligibility");
const { sendUrgentBroadcast } = require("./notificationOrchestrator");

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

// `review`, when given, is { reviewedById, reviewedText } -- written in
// the same create call rather than a later PUT. This is the inline
// "approve now" path from the creation form: the admin who just typed
// this text can confirm, right then, that it's safe to send verbatim,
// instead of always needing a separate trip to Pending Notifications
// afterward. Harmless to pass for a non-restricted partner's row (or
// any type outside REVIEW_GATED_TYPES) -- needsReview() never even
// looks at reviewedAt in that case, so it's simply never consulted.
async function enqueue(type, partnerId, payload, review) {
  const reviewFields = review
    ? { reviewedAt: new Date(), reviewedById: review.reviewedById, reviewedText: review.reviewedText }
    : {};
  return prisma.notifiableEvent.create({ data: { type, partnerId, payload, ...reviewFields } });
}

// The one place recording still depends on a setting, and it's
// deliberately narrow: only restricted-partner events, only this one
// setting. Every other event type, for every other reason, is always
// recorded.
//
// Deliberately re-fetches isRestricted fresh by id rather than trusting
// whatever shape the caller's own partner object happens to have --
// this is the one safety-critical check in the whole system, and every
// call site here passes through a route's own partnerRefSelect (just
// { id, kind, displayName }, built for rendering responses, not for
// this check), not a guaranteed { isRestricted } shape. Trusting that
// shape silently never gates anything, exactly the bug this re-fetch
// exists to rule out.
async function recordEvent(type, partner, payload, review) {
  const [settings, freshPartner] = await Promise.all([
    getChurchSettings(),
    prisma.partner.findUnique({ where: { id: partner.id }, select: { isRestricted: true } }),
  ]);
  if (isRestrictedPartnerBlocked(freshPartner, settings)) return null;
  return enqueue(type, partner.id, payload, review);
}

// If `created.isUrgent` is set, fires the immediate cross-channel
// broadcast in addition to normal recording -- sendUrgentBroadcast
// itself still calls isEligibleForChannel per channel (restricted-
// partner review, GroupMe content-type mutes, the public digest's
// prayer-only structural rule all still apply; only each channel's own
// cadence/schedule wait is bypassed). Awaited, not fire-and-forget --
// see "Urgent broadcast" in the plan for why the creation request waits
// on this.
async function maybeBroadcastUrgent(row, partner, isUrgent) {
  if (!row || !isUrgent) return;
  await sendUrgentBroadcast(row, partner);
}

// `approval`, when given, is { reviewerId } -- set when the admin/editor
// checked "Review and approve now" on the creation form instead of
// leaving this for Pending Notifications later. reviewedText is always
// exactly what they just typed (requestText itself), never a separate
// edited version -- that's the deliberate scope of this inline path;
// a different broadcast wording still goes through Pending
// Notifications' own Edit flow after the fact.
async function notifyPrayerRequestCreated(prayerRequest, approval) {
  await safeNotify("Prayer request created", async () => {
    const review = approval
      ? { reviewedById: approval.reviewerId, reviewedText: prayerRequest.requestText }
      : null;
    const row = await recordEvent(
      "prayerRequestCreated",
      prayerRequest.partner,
      {
        partnerName: prayerRequest.partner?.displayName || "A partner",
        requestText: prayerRequest.requestText,
        sourceFileId: prayerRequest.sourceFile?.id || null,
      },
      review
    );
    await maybeBroadcastUrgent(row, prayerRequest.partner, prayerRequest.isUrgent);
  });
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await safeNotify("Prayer request answered", async () => {
    await recordEvent("prayerRequestAnswered", prayerRequest.partner, {
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
    const row = await recordEvent(
      "supportNeedCreated",
      supportNeed.partner,
      {
        partnerName: supportNeed.partner?.displayName || "A partner",
        description: supportNeed.description,
        // One-time needs never reach the public digest (not in
        // notificationBlurbs.js's PUBLIC_DIGEST_TYPES) -- admin-only, so
        // the requested amount is safe to surface in the notification
        // itself rather than requiring a trip to the One-Time Needs page.
        requestedAmount: supportNeed.requestedAmount,
        sourceFileId: supportNeed.sourceFile?.id || null,
      },
      review
    );
    await maybeBroadcastUrgent(row, supportNeed.partner, supportNeed.isUrgent);
  });
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", async () => {
    await recordEvent("supportNeedDecided", supportNeed.partner, {
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
    await recordEvent("newsletterCreated", newsletter.partner, {
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
