// The one function every channel -- GroupMe, WhatsApp, the admin email
// dispatch, the public email dispatch -- calls identically to decide
// whether a recorded DispatchRecord row belongs in its send, right now.
// See "Dispatch system redesign" for the full reasoning; this file is
// where it lives in code.
const prisma = require("../prismaClient");
const { PUBLIC_EMAIL_DISPATCH_TYPES, REVIEW_GATED_TYPES } = require("./dispatchBlurbs");

// Shared wrapper over the one ChurchSettings lookup every
// dispatch-related file needs at some point.
function getChurchSettings() {
  return prisma.churchSettings.findUnique({ where: { id: "singleton" } });
}

// Real constant, not magic strings -- a typo fails loudly instead of
// silently never matching.
const CHANNELS = {
  GROUPME: "groupme",
  WHATSAPP: "whatsapp",
  EMAIL_ADMIN: "emailAdmin",
  EMAIL_PUBLIC: "emailPublic",
};

// Shared with PUBLIC_EMAIL_DISPATCH_TYPES (dispatchBlurbs.js) -- one
// source for "which row types count as a one-time need."
const ONE_TIME_NEED_TYPES = new Set(["supportNeedCreated", "supportNeedDecided"]);

// Shared by dispatchRecording.js's createDispatchRecord and Rule 1 below.
function isRestrictedPartnerBlocked(partner, settings) {
  return !!partner?.isRestricted && settings?.allowRestrictedPartnerDispatch === false;
}

// Still waiting on human review (#187), for the types REVIEW_GATED_TYPES
// covers only -- a restricted partner's newsletter is exempt (see that
// constant's own comment). Exported so the review-queue badge
// (routes/dispatches.js) and the clearing check
// (dispatchOrchestrator.js) ask the exact same question.
function needsReview(row, partner) {
  return !!partner?.isRestricted && REVIEW_GATED_TYPES.has(row.type) && !row.dispatchReviewedAt;
}

// Called once per (recorded event, channel) pair, every time a channel
// is about to send. hasEligibleRecipient is computed by the caller per
// channel (GroupMe/WhatsApp: always true once their shared schedule
// fired; admin/public: a subscriber on this cadence tier following this
// partner) -- "who's eligible" is a per-channel question this function
// doesn't need to answer itself.
function isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient) {
  // Rule 1 -- universal, every channel. A restricted partner's content
  // is never eligible anywhere until reviewed, or at all if the church
  // has turned restricted-partner dispatch off outright. The
  // review-wait excludes a restricted partner's newsletter on purpose --
  // buildBlurb() already fully suppresses it regardless of review state.
  if (isRestrictedPartnerBlocked(partner, settings)) return false;
  if (needsReview(row, partner)) return false;

  // Rule 2 -- content-type preference, chat channels (GroupMe/WhatsApp)
  // only. The admin email dispatch always includes everything it's
  // allowed to (periodic batched email, no real noise problem to mute);
  // the public email dispatch is structurally prayer-requests-only, not
  // a preference it checks.
  const isPrayerRequestType = PUBLIC_EMAIL_DISPATCH_TYPES.has(row.type);
  // WhatsApp is the same kind of chat channel, so it shares GroupMe's
  // three content-type mutes.
  if (channel === CHANNELS.GROUPME || channel === CHANNELS.WHATSAPP) {
    if (isPrayerRequestType && settings?.chatDispatchPrayerRequests === false) return false;
    if (ONE_TIME_NEED_TYPES.has(row.type) && settings?.chatDispatchOneTimeNeeds === false) return false;
    if (row.type === "newsletterCreated" && settings?.chatDispatchNewsletters === false) return false;
  }
  if (channel === CHANNELS.EMAIL_PUBLIC) {
    if (!isPrayerRequestType) return false;
    if (!partner?.isPublic) return false;
  }
  // channel === CHANNELS.EMAIL_ADMIN: no content-type check at all --
  // falls through to Rule 3 unconditionally.

  // Rule 3 -- is anyone actually there to receive it right now.
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
