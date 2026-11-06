const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// notificationEligibility.js transitively requires prismaClient.js (via
// getChurchSettings), which reads DATABASE_URL eagerly at require time
// -- same reason digestScheduler.test.js needs this. needsReview()/
// isEligibleForChannel() themselves are pure, no DB touched by anything
// this file actually calls.
require("dotenv").config({ quiet: true });
const {
  CHANNELS,
  isRestrictedPartnerBlocked,
  needsReview,
  isEligibleForChannel,
} = require("../src/utils/notificationEligibility");

const onSettings = { allowRestrictedPartnerNotifications: true };

describe("isRestrictedPartnerBlocked", () => {
  test("a restricted partner is blocked only when the church has opted out entirely", () => {
    assert.equal(
      isRestrictedPartnerBlocked({ isRestricted: true }, { allowRestrictedPartnerNotifications: false }),
      true
    );
    assert.equal(isRestrictedPartnerBlocked({ isRestricted: true }, onSettings), false);
  });

  test("a non-restricted partner is never blocked, regardless of the setting", () => {
    assert.equal(
      isRestrictedPartnerBlocked({ isRestricted: false }, { allowRestrictedPartnerNotifications: false }),
      false
    );
  });
});

describe("needsReview", () => {
  test("a restricted partner's real-content row, never reviewed, needs review", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", reviewedAt: null }, { isRestricted: true }),
      true
    );
  });

  test("a restricted partner's real-content row, once reviewed, no longer needs review", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", reviewedAt: new Date() }, { isRestricted: true }),
      false
    );
  });

  test("a non-restricted partner's row never needs review, regardless of type", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", reviewedAt: null }, { isRestricted: false }),
      false
    );
  });

  test("newsletterCreated never needs review, even for a restricted partner", () => {
    assert.equal(needsReview({ type: "newsletterCreated", reviewedAt: null }, { isRestricted: true }), false);
  });

  test("a missing partner (deleted) is treated as not restricted", () => {
    assert.equal(needsReview({ type: "prayerRequestCreated", reviewedAt: null }, null), false);
  });
});

// The uniform function every channel shares -- same shape, same order,
// regardless of channel or event type. Rule 1 (restricted/review) is
// universal; Rule 2 (content-type/structural) differs per channel; Rule
// 3 (recipient presence) is just whatever's passed in.
describe("isEligibleForChannel", () => {
  const restrictedUnreviewed = { isRestricted: true };
  const restrictedReviewed = { isRestricted: true };
  const normalPublicPartner = { isRestricted: false, isPublic: true };
  const normalPrivatePartner = { isRestricted: false, isPublic: false };

  test("restricted-and-unreviewed is ineligible everywhere, for every channel, for the review-gated types", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: null };
    for (const channel of Object.values(CHANNELS)) {
      assert.equal(isEligibleForChannel(row, channel, restrictedUnreviewed, onSettings, true), false);
    }
  });

  test("REGRESSION: a restricted partner's unreviewed newsletter is NOT held the same way -- buildBlurb already fully suppresses it, nothing left to gate", () => {
    const newsletterRow = { type: "newsletterCreated", reviewedAt: null };
    const prayerRow = { type: "prayerRequestCreated", reviewedAt: null };
    // Same restricted, unreviewed partner -- the newsletter type must
    // pass Rule 1 where the prayer-request type does not. A type-blind
    // implementation of Rule 1 would make both false, which is exactly
    // the bug this plan found and fixed.
    assert.equal(
      isEligibleForChannel(newsletterRow, CHANNELS.ADMIN_DIGEST, restrictedUnreviewed, onSettings, true),
      true
    );
    assert.equal(
      isEligibleForChannel(prayerRow, CHANNELS.ADMIN_DIGEST, restrictedUnreviewed, onSettings, true),
      false
    );
  });

  test("restricted-and-reviewed is eligible wherever else it qualifies", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: new Date() };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.ADMIN_DIGEST, restrictedReviewed, onSettings, true),
      true
    );
  });

  test("allowRestrictedPartnerNotifications off blocks every channel, even once reviewed", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: new Date() };
    const off = { allowRestrictedPartnerNotifications: false };
    assert.equal(isEligibleForChannel(row, CHANNELS.ADMIN_DIGEST, restrictedReviewed, off, true), false);
  });

  test("a GroupMe content-type mute excludes GroupMe only -- the admin digest for the identical row, same tick, stays unaffected", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: null };
    const settings = { ...onSettings, notifyGroupMePrayerRequests: false };
    assert.equal(isEligibleForChannel(row, CHANNELS.GROUPME, normalPublicPartner, settings, true), false);
    assert.equal(isEligibleForChannel(row, CHANNELS.ADMIN_DIGEST, normalPublicPartner, settings, true), true);
  });

  test("the admin digest never checks content-type mutes at all", () => {
    const settings = {
      ...onSettings,
      notifyGroupMePrayerRequests: false,
      notifyGroupMeOneTimeNeeds: false,
      notifyGroupMeNewsletters: false,
    };
    for (const type of ["prayerRequestCreated", "supportNeedCreated", "newsletterCreated"]) {
      assert.equal(
        isEligibleForChannel(
          { type, reviewedAt: null },
          CHANNELS.ADMIN_DIGEST,
          normalPublicPartner,
          settings,
          true
        ),
        true
      );
    }
  });

  test("the public digest rejects anything that isn't a prayer request, regardless of any other setting", () => {
    const row = { type: "supportNeedCreated", reviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.PUBLIC_DIGEST, normalPublicPartner, onSettings, true),
      false
    );
  });

  test("the public digest rejects a prayer request whose partner isn't public", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.PUBLIC_DIGEST, normalPrivatePartner, onSettings, true),
      false
    );
  });

  test("the public digest accepts a public partner's prayer request", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.PUBLIC_DIGEST, normalPublicPartner, onSettings, true),
      true
    );
  });

  test("Rule 3 -- no eligible recipient means ineligible, even when every other rule passes", () => {
    const row = { type: "prayerRequestCreated", reviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.ADMIN_DIGEST, normalPublicPartner, onSettings, false),
      false
    );
  });
});
