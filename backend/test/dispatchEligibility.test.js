const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// dispatchEligibility.js transitively requires prismaClient.js (via getChurchSettings), which
// reads DATABASE_URL eagerly at require time, as in emailDispatchScheduler.test.js.
// needsReview()/isEligibleForChannel() themselves are pure; nothing here touches the DB.
require("dotenv").config({ quiet: true });
const {
  CHANNELS,
  isRestrictedPartnerBlocked,
  needsReview,
  isEligibleForChannel,
} = require("../src/utils/dispatchEligibility");

const onSettings = { allowRestrictedPartnerDispatch: true };

describe("isRestrictedPartnerBlocked", () => {
  test("a restricted partner is blocked only when the church has opted out entirely", () => {
    assert.equal(
      isRestrictedPartnerBlocked({ isRestricted: true }, { allowRestrictedPartnerDispatch: false }),
      true
    );
    assert.equal(isRestrictedPartnerBlocked({ isRestricted: true }, onSettings), false);
  });

  test("a non-restricted partner is never blocked, regardless of the setting", () => {
    assert.equal(
      isRestrictedPartnerBlocked({ isRestricted: false }, { allowRestrictedPartnerDispatch: false }),
      false
    );
  });
});

describe("needsReview", () => {
  test("a restricted partner's real-content row, never reviewed, needs review", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", dispatchReviewedAt: null }, { isRestricted: true }),
      true
    );
  });

  test("a restricted partner's real-content row, once reviewed, no longer needs review", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", dispatchReviewedAt: new Date() }, { isRestricted: true }),
      false
    );
  });

  test("a non-restricted partner's row never needs review, regardless of type", () => {
    assert.equal(
      needsReview({ type: "prayerRequestCreated", dispatchReviewedAt: null }, { isRestricted: false }),
      false
    );
  });

  test("newsletterCreated never needs review, even for a restricted partner", () => {
    assert.equal(
      needsReview({ type: "newsletterCreated", dispatchReviewedAt: null }, { isRestricted: true }),
      false
    );
  });

  test("a missing partner (deleted) is treated as not restricted", () => {
    assert.equal(needsReview({ type: "prayerRequestCreated", dispatchReviewedAt: null }, null), false);
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
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    for (const channel of Object.values(CHANNELS)) {
      assert.equal(isEligibleForChannel(row, channel, restrictedUnreviewed, onSettings, true), false);
    }
  });

  test("REGRESSION: a restricted partner's unreviewed newsletter is NOT held the same way -- buildBlurb already fully suppresses it, nothing left to gate", () => {
    const newsletterRow = { type: "newsletterCreated", dispatchReviewedAt: null };
    const prayerRow = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    // Same restricted, unreviewed partner: the newsletter type must pass Rule 1 where the
    // prayer-request type does not. A type-blind implementation of Rule 1 would make both false.
    assert.equal(
      isEligibleForChannel(newsletterRow, CHANNELS.EMAIL_ADMIN, restrictedUnreviewed, onSettings, true),
      true
    );
    assert.equal(
      isEligibleForChannel(prayerRow, CHANNELS.EMAIL_ADMIN, restrictedUnreviewed, onSettings, true),
      false
    );
  });

  test("restricted-and-reviewed is eligible wherever else it qualifies", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: new Date() };
    assert.equal(isEligibleForChannel(row, CHANNELS.EMAIL_ADMIN, restrictedReviewed, onSettings, true), true);
  });

  test("allowRestrictedPartnerDispatch off blocks every channel, even once reviewed", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: new Date() };
    const off = { allowRestrictedPartnerDispatch: false };
    assert.equal(isEligibleForChannel(row, CHANNELS.EMAIL_ADMIN, restrictedReviewed, off, true), false);
  });

  test("a GroupMe content-type mute excludes GroupMe only -- the admin digest for the identical row, same tick, stays unaffected", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    const settings = { ...onSettings, chatDispatchPrayerRequests: false };
    assert.equal(isEligibleForChannel(row, CHANNELS.GROUPME, normalPublicPartner, settings, true), false);
    assert.equal(isEligibleForChannel(row, CHANNELS.EMAIL_ADMIN, normalPublicPartner, settings, true), true);
  });

  test("the admin digest never checks content-type mutes at all", () => {
    const settings = {
      ...onSettings,
      chatDispatchPrayerRequests: false,
      chatDispatchOneTimeNeeds: false,
      chatDispatchNewsletters: false,
    };
    for (const type of ["prayerRequestCreated", "supportNeedCreated", "newsletterCreated"]) {
      assert.equal(
        isEligibleForChannel(
          { type, dispatchReviewedAt: null },
          CHANNELS.EMAIL_ADMIN,
          normalPublicPartner,
          settings,
          true
        ),
        true
      );
    }
  });

  test("the public digest rejects anything that isn't a prayer request, regardless of any other setting", () => {
    const row = { type: "supportNeedCreated", dispatchReviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.EMAIL_PUBLIC, normalPublicPartner, onSettings, true),
      false
    );
  });

  test("the public digest rejects a prayer request whose partner isn't public", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.EMAIL_PUBLIC, normalPrivatePartner, onSettings, true),
      false
    );
  });

  test("the public digest accepts a public partner's prayer request", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.EMAIL_PUBLIC, normalPublicPartner, onSettings, true),
      true
    );
  });

  test("Rule 3 -- no eligible recipient means ineligible, even when every other rule passes", () => {
    const row = { type: "prayerRequestCreated", dispatchReviewedAt: null };
    assert.equal(
      isEligibleForChannel(row, CHANNELS.EMAIL_ADMIN, normalPublicPartner, onSettings, false),
      false
    );
  });
});

// A record made from a care team member's prayer request or need is held for staff review
// whatever the partner, on every channel (the admin email digest and the chat channels as well
// as the public email), and the one release is the same dispatchReviewedAt that releases a
// restricted partner's content.
describe("reviewRequired (care team submissions)", () => {
  const ordinary = { isRestricted: false, isPublic: true };
  const held = (type, extra = {}) => ({ type, reviewRequired: true, dispatchReviewedAt: null, ...extra });

  test("holds an ordinary partner's prayer request or need until reviewed", () => {
    for (const type of [
      "prayerRequestCreated",
      "prayerRequestAnswered",
      "supportNeedCreated",
      "supportNeedDecided",
    ]) {
      assert.equal(needsReview(held(type), ordinary), true, type);
    }
  });

  test("releases once staff have reviewed it", () => {
    assert.equal(
      needsReview(held("prayerRequestCreated", { dispatchReviewedAt: new Date() }), ordinary),
      false
    );
  });

  test("a staff-made record on an ordinary partner is never held", () => {
    assert.equal(needsReview({ type: "prayerRequestCreated", reviewRequired: false }, ordinary), false);
    assert.equal(needsReview({ type: "prayerRequestCreated" }, ordinary), false);
  });

  test("is not eligible on ANY channel while held, and becomes eligible when reviewed", () => {
    const row = held("supportNeedCreated");
    for (const channel of Object.values(CHANNELS)) {
      assert.equal(isEligibleForChannel(row, channel, ordinary, onSettings, true), false, channel);
    }
    const released = { ...row, dispatchReviewedAt: new Date() };
    assert.equal(isEligibleForChannel(released, CHANNELS.EMAIL_ADMIN, ordinary, onSettings, true), true);
    assert.equal(isEligibleForChannel(released, CHANNELS.GROUPME, ordinary, onSettings, true), true);
    assert.equal(isEligibleForChannel(released, CHANNELS.WHATSAPP, ordinary, onSettings, true), true);
  });

  test("a care team member's newsletter is held too, but a restricted partner's own newsletter is still exempt", () => {
    assert.equal(needsReview({ type: "newsletterCreated", reviewRequired: true }, ordinary), true);
    assert.equal(
      needsReview(
        { type: "newsletterCreated", reviewRequired: true, dispatchReviewedAt: new Date() },
        ordinary
      ),
      false
    );
    // Restricted partner, staff-made newsletter -> not held.
    assert.equal(needsReview({ type: "newsletterCreated" }, { isRestricted: true }), false);
  });
});
