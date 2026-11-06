// The one function every channel -- GroupMe, the admin digest, the
// public digest -- calls identically to decide whether a recorded
// NotifiableEvent row belongs in its send, right now. See "Notification
// system redesign" for the full reasoning; this file is where it lives
// in code.
const prisma = require("../prismaClient");
const { PUBLIC_DIGEST_TYPES, REVIEW_GATED_TYPES } = require("./notificationBlurbs");

// Shared wrapper over the one ChurchSettings lookup every
// notification-related file needs at some point.
function getChurchSettings() {
  return prisma.churchSettings.findUnique({ where: { id: "singleton" } });
}

// Real constant, not magic strings -- a typo fails loudly instead of
// silently never matching.
const CHANNELS = { GROUPME: "groupme", ADMIN_DIGEST: "adminDigest", PUBLIC_DIGEST: "publicDigest" };

// Shared with PUBLIC_DIGEST_TYPES (notificationBlurbs.js) -- one source
// for "which row types count as a one-time need."
const ONE_TIME_NEED_TYPES = new Set(["supportNeedCreated", "supportNeedDecided"]);

// Shared by notificationRecording.js's recordEvent and Rule 1 below.
function isRestrictedPartnerBlocked(partner, settings) {
  return !!partner?.isRestricted && settings?.allowRestrictedPartnerNotifications === false;
}

// Still waiting on human review (#187), for the types REVIEW_GATED_TYPES
// covers only -- a restricted partner's newsletter is exempt (see that
// constant's own comment). Exported so the review-queue badge
// (routes/notifications.js) and the clearing check
// (notificationOrchestrator.js) ask the exact same question.
function needsReview(row, partner) {
  return !!partner?.isRestricted && REVIEW_GATED_TYPES.has(row.type) && !row.reviewedAt;
}

// Called once per (recorded event, channel) pair, every time a channel
// is about to send. hasEligibleRecipient is computed by the caller per
// channel (GroupMe: always true once its own schedule fired; admin/
// public: a subscriber on this cadence tier following this partner) --
// "who's eligible" is a per-channel question this function doesn't need
// to answer itself.
function isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient) {
  // Rule 1 -- universal, every channel. A restricted partner's content
  // is never eligible anywhere until reviewed, or at all if the church
  // has turned restricted-partner notifications off outright. The
  // review-wait excludes a restricted partner's newsletter on purpose --
  // buildBlurb() already fully suppresses it regardless of review state.
  if (isRestrictedPartnerBlocked(partner, settings)) return false;
  if (needsReview(row, partner)) return false;

  // Rule 2 -- content-type preference, GroupMe only. The admin digest
  // always includes everything it's allowed to (periodic batched email,
  // no real noise problem to mute); the public digest is structurally
  // prayer-requests-only, not a preference it checks.
  const isPrayerRequestType = PUBLIC_DIGEST_TYPES.has(row.type);
  if (channel === CHANNELS.GROUPME) {
    if (isPrayerRequestType && settings?.notifyGroupMePrayerRequests === false) return false;
    if (ONE_TIME_NEED_TYPES.has(row.type) && settings?.notifyGroupMeOneTimeNeeds === false) return false;
    if (row.type === "newsletterCreated" && settings?.notifyGroupMeNewsletters === false) return false;
  }
  if (channel === CHANNELS.PUBLIC_DIGEST) {
    if (!isPrayerRequestType) return false;
    if (!partner?.isPublic) return false;
  }
  // channel === CHANNELS.ADMIN_DIGEST: no content-type check at all --
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
