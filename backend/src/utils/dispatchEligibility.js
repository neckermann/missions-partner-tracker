// The one function every channel (GroupMe, WhatsApp, admin and public email
// dispatch) calls to decide whether a recorded DispatchRecord row belongs in its send now.
const prisma = require("../prismaClient");
const { PUBLIC_EMAIL_DISPATCH_TYPES, REVIEW_GATED_TYPES, CARE_DISPATCH_TYPES } = require("./dispatchBlurbs");

// Shared wrapper over the ChurchSettings lookup every dispatch file needs.
function getChurchSettings() {
  return prisma.churchSettings.findUnique({ where: { id: "singleton" } });
}

// Constants, so a typo fails loudly instead of silently never matching.
const CHANNELS = {
  GROUPME: "groupme",
  WHATSAPP: "whatsapp",
  EMAIL_ADMIN: "emailAdmin",
  EMAIL_PUBLIC: "emailPublic",
};

// Shared with PUBLIC_EMAIL_DISPATCH_TYPES (dispatchBlurbs.js): which row types count as a one-time need.
const ONE_TIME_NEED_TYPES = new Set(["supportNeedCreated", "supportNeedDecided"]);

// Shared by dispatchRecording.js's createDispatchRecord and Rule 1 below.
function isRestrictedPartnerBlocked(partner, settings) {
  return !!partner?.isRestricted && settings?.allowRestrictedPartnerDispatch === false;
}

// Still waiting on human review, for REVIEW_GATED_TYPES only (a restricted
// partner's newsletter is exempt). Exported so the review-queue badge
// (routes/dispatches.js) and the clearing check (dispatchOrchestrator.js) agree.
function needsReview(row, partner) {
  // Held when it's a restricted partner's real content (REVIEW_GATED_TYPES), OR
  // the record says staff must look first (made from a care team member's
  // submission, any type: nothing a non-staff login enters goes out unreviewed).
  // Either way the one release is dispatchReviewedAt, set by Pending Dispatches' review.
  const held = (!!partner?.isRestricted && REVIEW_GATED_TYPES.has(row.type)) || !!row.reviewRequired;
  return held && !row.dispatchReviewedAt;
}

// Called once per (recorded event, channel) pair whenever a channel is about to
// send. hasEligibleRecipient is computed by the caller per channel (chat: true
// once the shared schedule fired; email: a subscriber on this tier following this partner).
function isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient) {
  // Rule 1, every channel: a restricted partner's content is never eligible until
  // reviewed, or at all if restricted-partner dispatch is off. The review-wait
  // excludes a restricted newsletter because buildBlurb() already suppresses it.
  if (isRestrictedPartnerBlocked(partner, settings)) return false;
  if (needsReview(row, partner)) return false;

  // Rule 2, chat channels only: content-type preference. The admin email
  // includes everything allowed (batched, no noise problem); the public email is
  // structurally prayer-requests-only.
  const isPrayerRequestType = PUBLIC_EMAIL_DISPATCH_TYPES.has(row.type);
  // WhatsApp shares GroupMe's three content-type mutes.
  if (channel === CHANNELS.GROUPME || channel === CHANNELS.WHATSAPP) {
    if (isPrayerRequestType && settings?.chatDispatchPrayerRequests === false) return false;
    if (ONE_TIME_NEED_TYPES.has(row.type) && settings?.chatDispatchOneTimeNeeds === false) return false;
    if (row.type === "newsletterCreated" && settings?.chatDispatchNewsletters === false) return false;
    // The partner care posts are opt-in: each type posts only when its own switch is on.
    if (row.type === "keyDateComing" && settings?.chatDispatchKeyDates !== true) return false;
    if (row.type === "quietPartner" && settings?.chatDispatchQuietPartners !== true) return false;
    if (row.type === "updateToPassOn" && settings?.chatDispatchUpdatesToPass !== true) return false;
  } else if (CARE_DISPATCH_TYPES.has(row.type)) {
    // Chat-only: the digest carries key dates in its own section, and the bell carries the rest.
    return false;
  }
  if (channel === CHANNELS.EMAIL_PUBLIC) {
    if (!isPrayerRequestType) return false;
    if (!partner?.isPublic) return false;
  }
  // EMAIL_ADMIN: no content-type check; falls through to Rule 3.

  // Rule 3: is anyone there to receive it right now.
  return !!hasEligibleRecipient;
}

module.exports = {
  CHANNELS,
  ONE_TIME_NEED_TYPES,
  getChurchSettings,
  isRestrictedPartnerBlocked,
  needsReview,
  isEligibleForChannel,
};
