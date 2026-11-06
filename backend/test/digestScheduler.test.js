const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// digestScheduler.js transitively requires prismaClient.js (for the
// DB-touching parts of checkAndMaybeFlush, not exercised by this file),
// which reads DATABASE_URL eagerly at require time -- same reason
// requireAuth.test.js needs this. shouldFlushNow() itself is pure, no
// DB touched by anything this file actually calls.
require("dotenv").config({ quiet: true });
const {
  shouldFlushNow,
  shouldFlushWeeklyScopedDigest,
  shouldFlushBiweeklyScopedDigest,
  shouldFlushMonthlyScopedDigest,
} = require("../src/utils/digestScheduler");

// Wednesday, Jan 7 2026, 9:00:00 AM local time -- day 3, date 7, hour 9.
const WED_9AM = new Date(2026, 0, 7, 9, 0, 0);

describe("shouldFlushNow -- no schedule configured", () => {
  test("digestFrequency: null never fires, regardless of day/hour", () => {
    assert.equal(shouldFlushNow({ digestFrequency: null }, WED_9AM), false);
  });

  test("a missing settings row (brand-new instance) never fires", () => {
    assert.equal(shouldFlushNow(null, WED_9AM), false);
  });
});

describe("shouldFlushNow -- weekly", () => {
  const base = { digestFrequency: "weekly", digestDayOfWeek: 3, digestHour: 9, lastDigestSentAt: null };

  test("fires on the exact matching day+hour with no prior send", () => {
    assert.equal(shouldFlushNow(base, WED_9AM), true);
  });

  test("does not fire on the right day but wrong hour", () => {
    assert.equal(shouldFlushNow({ ...base, digestHour: 14 }, WED_9AM), false);
  });

  test("does not fire on the right hour but wrong day", () => {
    assert.equal(shouldFlushNow({ ...base, digestDayOfWeek: 1 }, WED_9AM), false);
  });

  test("does not re-fire within the same matching hour as the last send", () => {
    const tenMinutesAgo = new Date(WED_9AM.getTime() - 10 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: tenMinutesAgo }, WED_9AM), false);
  });

  test("fires again a full week later", () => {
    const sevenDaysAgo = new Date(WED_9AM.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: sevenDaysAgo }, WED_9AM), true);
  });

  test("does not fire again after only 3 days (still mid-week-cycle)", () => {
    const threeDaysAgo = new Date(WED_9AM.getTime() - 3 * 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: threeDaysAgo }, WED_9AM), false);
  });
});

describe("shouldFlushNow -- biweekly (same day-of-week field, longer gap)", () => {
  const base = { digestFrequency: "biweekly", digestDayOfWeek: 3, digestHour: 9, lastDigestSentAt: null };

  test("fires on the matching day+hour with no prior send", () => {
    assert.equal(shouldFlushNow(base, WED_9AM), true);
  });

  test("does not fire again after only 7 days -- that's a weekly gap, not biweekly's", () => {
    const sevenDaysAgo = new Date(WED_9AM.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushNow({ ...base, lastDigestSentAt: sevenDaysAgo }, WED_9AM),
      false,
      "this is the exact check that actually distinguishes weekly from biweekly"
    );
  });

  test("fires again after a full 13+ days", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: thirteenDaysAgo }, WED_9AM), true);
  });
});

describe("shouldFlushNow -- monthly", () => {
  const base = { digestFrequency: "monthly", digestDayOfMonth: 7, digestHour: 9, lastDigestSentAt: null };

  test("fires on the matching day-of-month+hour, ignoring day-of-week entirely", () => {
    assert.equal(shouldFlushNow(base, WED_9AM), true);
  });

  test("does not fire on the wrong day-of-month", () => {
    assert.equal(shouldFlushNow({ ...base, digestDayOfMonth: 15 }, WED_9AM), false);
  });

  test("does not fire again after only 13 days -- that's biweekly's gap, not monthly's", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: thirteenDaysAgo }, WED_9AM), false);
  });

  test("fires again after a full 27+ days", () => {
    const twentySevenDaysAgo = new Date(WED_9AM.getTime() - 27 * 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushNow({ ...base, lastDigestSentAt: twentySevenDaysAgo }, WED_9AM), true);
  });
});

// Same weekly/biweekly/monthly matrix as shouldFlushNow above, against
// the three new scoped-digest gates (#202) -- genuinely independent
// fields (scopedDigest* / last*ScopedDigestSentAt), not the internal
// digest's own digestFrequency/digestDayOfWeek/etc.

describe("shouldFlushWeeklyScopedDigest", () => {
  const base = { scopedDigestDayOfWeek: 3, scopedDigestHour: 9, lastWeeklyScopedDigestSentAt: null };

  test("not configured yet (brand-new instance, no schedule set) never fires", () => {
    assert.equal(shouldFlushWeeklyScopedDigest({}, WED_9AM), false);
    assert.equal(shouldFlushWeeklyScopedDigest(null, WED_9AM), false);
    assert.equal(
      shouldFlushWeeklyScopedDigest({ scopedDigestDayOfWeek: 3, scopedDigestHour: null }, WED_9AM),
      false
    );
  });

  test("fires on the exact matching day+hour with no prior send", () => {
    assert.equal(shouldFlushWeeklyScopedDigest(base, WED_9AM), true);
  });

  test("does not fire on the wrong day or wrong hour", () => {
    assert.equal(shouldFlushWeeklyScopedDigest({ ...base, scopedDigestDayOfWeek: 1 }, WED_9AM), false);
    assert.equal(shouldFlushWeeklyScopedDigest({ ...base, scopedDigestHour: 14 }, WED_9AM), false);
  });

  test("does not re-fire within the same matching hour as the last send", () => {
    const tenMinutesAgo = new Date(WED_9AM.getTime() - 10 * 60 * 1000);
    assert.equal(
      shouldFlushWeeklyScopedDigest({ ...base, lastWeeklyScopedDigestSentAt: tenMinutesAgo }, WED_9AM),
      false
    );
  });

  test("fires again a full week later", () => {
    const sevenDaysAgo = new Date(WED_9AM.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushWeeklyScopedDigest({ ...base, lastWeeklyScopedDigestSentAt: sevenDaysAgo }, WED_9AM),
      true
    );
  });
});

describe("shouldFlushBiweeklyScopedDigest (shares scopedDigestDayOfWeek, longer gap)", () => {
  const base = { scopedDigestDayOfWeek: 3, scopedDigestHour: 9, lastBiweeklyScopedDigestSentAt: null };

  test("fires on the matching day+hour with no prior send", () => {
    assert.equal(shouldFlushBiweeklyScopedDigest(base, WED_9AM), true);
  });

  test("does not fire again after only 7 days -- that's weekly's gap, not biweekly's", () => {
    const sevenDaysAgo = new Date(WED_9AM.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyScopedDigest({ ...base, lastBiweeklyScopedDigestSentAt: sevenDaysAgo }, WED_9AM),
      false
    );
  });

  test("fires again after a full 13+ days", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyScopedDigest({ ...base, lastBiweeklyScopedDigestSentAt: thirteenDaysAgo }, WED_9AM),
      true
    );
  });

  test("not configured yet never fires", () => {
    assert.equal(shouldFlushBiweeklyScopedDigest({}, WED_9AM), false);
  });
});

describe("shouldFlushMonthlyScopedDigest", () => {
  const base = { scopedDigestDayOfMonth: 7, scopedDigestHour: 9, lastMonthlyScopedDigestSentAt: null };

  test("fires on the matching day-of-month+hour, ignoring day-of-week entirely", () => {
    assert.equal(shouldFlushMonthlyScopedDigest(base, WED_9AM), true);
  });

  test("does not fire on the wrong day-of-month", () => {
    assert.equal(shouldFlushMonthlyScopedDigest({ ...base, scopedDigestDayOfMonth: 15 }, WED_9AM), false);
  });

  test("does not fire again after only 13 days -- that's biweekly's gap, not monthly's", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushMonthlyScopedDigest({ ...base, lastMonthlyScopedDigestSentAt: thirteenDaysAgo }, WED_9AM),
      false
    );
  });

  test("fires again after a full 27+ days", () => {
    const twentySevenDaysAgo = new Date(WED_9AM.getTime() - 27 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushMonthlyScopedDigest({ ...base, lastMonthlyScopedDigestSentAt: twentySevenDaysAgo }, WED_9AM),
      true
    );
  });

  test("not configured yet never fires", () => {
    assert.equal(shouldFlushMonthlyScopedDigest({}, WED_9AM), false);
  });
});
