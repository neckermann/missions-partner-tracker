// Shared mechanism behind the scoped prayer-request/content digest
// (#202) -- named for the mechanism, not either audience. `User`
// (admin/editor/viewer) and `PublicSubscriber` recipients both ride the
// same cadence tiers and the same send pass; see the plan this was built
// from for the full architecture. This file currently only holds the
// token functions Phase 1 needs (subscribe/confirm/unsubscribe) -- the
// actual send-pass function lands in a later phase.
const jwt = require("jsonwebtoken");
const { appBaseUrl } = require("./notificationBlurbs");

// Same { id, <purpose>: true } shape routes/auth.js already uses for its
// own unsubscribe token (and MFA-pending/MFA-setup tokens before that),
// signed with the same SESSION_SECRET, deliberately with no expiresIn --
// a confirm/unsubscribe link saved from an old email should still work.
// Two distinct discriminator keys, not one shared `subscriber: true`,
// so a confirm link can never be replayed as an unsubscribe link or vice
// versa -- and distinct from User's own `{ id, unsubscribe: true }`
// shape so a PublicSubscriber token can't be confused with a User one
// either (both are verified with the same secret, so the discriminator
// key is the only thing telling them apart).
function buildSubscriberConfirmToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberConfirm: true }, process.env.SESSION_SECRET);
}

function buildSubscriberUnsubscribeToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
}

function buildSubscriberConfirmUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/subscribe/confirm?token=${encodeURIComponent(buildSubscriberConfirmToken(subscriberId))}`;
}

function buildSubscriberUnsubscribeUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/unsubscribe?token=${encodeURIComponent(buildSubscriberUnsubscribeToken(subscriberId))}`;
}

module.exports = {
  buildSubscriberConfirmToken,
  buildSubscriberUnsubscribeToken,
  buildSubscriberConfirmUrl,
  buildSubscriberUnsubscribeUrl,
};
