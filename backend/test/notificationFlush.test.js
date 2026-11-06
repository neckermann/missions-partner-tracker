const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// notificationFlush.js transitively requires prismaClient.js (via
// emailDigest.js/groupme.js), which reads DATABASE_URL eagerly at
// require time -- same reason digestScheduler.test.js needs this.
// tierApplies()/needsReview() themselves are pure, no DB touched by
// anything this file actually calls.
require("dotenv").config({ quiet: true });
const { tierApplies, needsReview } = require("../src/utils/notificationFlush");

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

describe("tierApplies", () => {
  const scheduled = { weekly: true, biweekly: true, monthly: true };
  const unscheduled = { weekly: false, biweekly: false, monthly: false };
  const publicPartner = { isPublic: true };
  const privatePartner = { isPublic: false };

  test("not configured at all -- never applies to any row, regardless of subscribers", () => {
    const counts = {
      adminSubscriberCountByTier: { weekly: 5 },
      publicSubscriberCountByTier: { weekly: 5 },
      tierScheduled: unscheduled,
    };
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "weekly", publicPartner, counts), false);
  });

  test("an admin-only type (supportNeedCreated) applies once any admin is subscribed at that tier, ignoring public entirely", () => {
    const counts = {
      adminSubscriberCountByTier: { weekly: 1 },
      publicSubscriberCountByTier: { weekly: 0 },
      tierScheduled: scheduled,
    };
    assert.equal(tierApplies({ type: "supportNeedCreated" }, "weekly", publicPartner, counts), true);
  });

  test("an admin-only type never applies via a public subscriber, even on a public partner", () => {
    const counts = {
      adminSubscriberCountByTier: { weekly: 0 },
      publicSubscriberCountByTier: { weekly: 5 },
      tierScheduled: scheduled,
    };
    assert.equal(tierApplies({ type: "supportNeedCreated" }, "weekly", publicPartner, counts), false);
    assert.equal(tierApplies({ type: "newsletterCreated" }, "weekly", publicPartner, counts), false);
  });

  test("a prayer-request type applies via a public subscriber only when the partner is public", () => {
    const counts = {
      adminSubscriberCountByTier: {},
      publicSubscriberCountByTier: { weekly: 3 },
      tierScheduled: scheduled,
    };
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "weekly", publicPartner, counts), true);
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "weekly", privatePartner, counts), false);
  });

  test("a tier with zero eligible subscribers of either audience never applies, even when configured", () => {
    const counts = {
      adminSubscriberCountByTier: { weekly: 2 },
      publicSubscriberCountByTier: { weekly: 2 },
      tierScheduled: scheduled,
    };
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "monthly", publicPartner, counts), false);
  });

  test("either audience alone is enough -- an OR, not an AND", () => {
    const adminOnly = {
      adminSubscriberCountByTier: { weekly: 1 },
      publicSubscriberCountByTier: {},
      tierScheduled: scheduled,
    };
    const publicOnly = {
      adminSubscriberCountByTier: {},
      publicSubscriberCountByTier: { weekly: 1 },
      tierScheduled: scheduled,
    };
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "weekly", publicPartner, adminOnly), true);
    assert.equal(tierApplies({ type: "prayerRequestCreated" }, "weekly", publicPartner, publicOnly), true);
  });
});
