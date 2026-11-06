// The one function every channel -- GroupMe, the admin digest, the
// public digest -- calls identically to decide whether a recorded
// NotifiableEvent row belongs in its send, right now. Same shape, same
// order, every channel, every type. See the plan this was built from
// ("Notification system redesign") for the full reasoning; this file is
// deliberately the one place that reasoning lives in code.
const prisma = require("../prismaClient");
const { PUBLIC_DIGEST_TYPES, REVIEW_GATED_TYPES } = require("./notificationBlurbs");

// A thin, shared wrapper over the one ChurchSettings lookup every
// notification-related file needs at some point -- worth naming and
// sharing rather than each file re-typing the same findUnique.
function getChurchSettings() {
  return prisma.churchSettings.findUnique({ where: { id: "singleton" } });
}

// Real constant, not magic strings -- a typo here fails loudly (an
// undefined property access) instead of silently never matching.
const CHANNELS = { GROUPME: "groupme", ADMIN_DIGEST: "adminDigest", PUBLIC_DIGEST: "publicDigest" };

// Same reasoning as the existing PUBLIC_DIGEST_TYPES (notificationBlurbs.js):
// one shared source for "which row types count as a one-time need," not
// a repeated inline OR of two string literals at every call site that
// needs to ask.
const ONE_TIME_NEED_TYPES = new Set(["supportNeedCreated", "supportNeedDecided"]);

// Shared by notificationRecording.js's recordEvent and Rule 1 below --
// both need to ask "has this church opted out of restricted-partner
// notifications entirely."
function isRestrictedPartnerBlocked(partner, settings) {
  return !!partner?.isRestricted && settings?.allowRestrictedPartnerNotifications === false;
}

// Still waiting on a human to review this specific row (#187) -- the
// types REVIEW_GATED_TYPES actually covers only (a restricted partner's
// newsletter is exempt -- see that constant's own comment). Exported so
// routes/notifications.js's review-queue badge and
// notificationOrchestrator.js's clearing check can both ask the exact
// same question, rather than each re-deriving it.
function needsReview(row, partner) {
  return !!partner?.isRestricted && REVIEW_GATED_TYPES.has(row.type) && !row.reviewedAt;
}

// Called once per (recorded event, channel) pair, every time a channel
// is about to send. hasEligibleRecipient is computed by the caller per
// channel (GroupMe: always true once its own schedule just fired --
// its only "recipient" is the group itself; admin: a subscriber on this
// cadence tier, following this partner; public: a confirmed subscriber
// on this cadence tier, following this partner) and passed in, since
// "who's eligible" is a per-channel question this function doesn't need
// to know how to answer itself.
function isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient) {
  // Rule 1 -- universal. Applies to every channel equally. A restricted
  // partner's real content is never eligible anywhere until a human has
  // reviewed this specific row, and never eligible anywhere at all if
  // the church has turned restricted-partner notifications off
  // outright. The review-wait only applies to types REVIEW_GATED_TYPES
  // actually covers -- a restricted partner's newsletter is excluded on
  // purpose (buildBlurb() already fully suppresses it regardless of
  // review state, so there's no real content left to protect).
  if (isRestrictedPartnerBlocked(partner, settings)) return false;
  if (needsReview(row, partner)) return false;

  // Rule 2 -- content-type preference, GroupMe only. The admin digest
  // always includes every content type it's allowed to (no toggle, no
  // check at all) -- it's a periodic batched email, there's no real
  // noise problem to mute. The public digest never reads these either,
  // for the opposite reason: prayer-requests-only isn't a preference it
  // checks, it's structurally what the public digest is.
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
