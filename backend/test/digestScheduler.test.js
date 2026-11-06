const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// digestScheduler.js transitively requires prismaClient.js (for the
// DB-touching parts of checkAndMaybeFlushDigest, not exercised by this
// file), which reads DATABASE_URL eagerly at require time -- same
// reason requireAuth.test.js needs this. The should* functions
// themselves are pure, no DB touched by anything this file actually
// calls.
require("dotenv").config({ quiet: true });
const {
  shouldFlushBiweeklyScopedDigest,
  shouldFlushMonthlyScopedDigest,
  shouldFlushQuarterlyScopedDigest,
} = require("../src/utils/digestScheduler");
const { shouldFlushGroupMe } = require("../src/utils/groupmeChannel");

// Wednesday, Jan 7 2026, 9:00:00 AM local time -- day 3, date 7, hour 9.
const WED_9AM = new Date(2026, 0, 7, 9, 0, 0);

// The email digest's three cadence tiers -- weekly was retired along
// with the old church-wide batch mechanism; quarterly replaced it.
// Biweekly and monthly/quarterly each share one day field
// (scopedDigestDayOfWeek / scopedDigestDayOfMonth), told apart purely
// by each tier's own minimum-gap check against its own lastSentAt
// cursor.

describe("shouldFlushBiweeklyScopedDigest", () => {
  const base = { scopedDigestDayOfWeek: 3, scopedDigestHour: 9, lastBiweeklyScopedDigestSentAt: null };

  test("not configured yet (brand-new instance, no schedule set) never fires", () => {
    assert.equal(shouldFlushBiweeklyScopedDigest({}, WED_9AM), false);
    assert.equal(shouldFlushBiweeklyScopedDigest(null, WED_9AM), false);
    assert.equal(
      shouldFlushBiweeklyScopedDigest({ scopedDigestDayOfWeek: 3, scopedDigestHour: null }, WED_9AM),
      false
    );
  });

  test("fires on the exact matching day+hour with no prior send", () => {
    assert.equal(shouldFlushBiweeklyScopedDigest(base, WED_9AM), true);
  });

  test("does not fire on the wrong day or wrong hour", () => {
    assert.equal(shouldFlushBiweeklyScopedDigest({ ...base, scopedDigestDayOfWeek: 1 }, WED_9AM), false);
    assert.equal(shouldFlushBiweeklyScopedDigest({ ...base, scopedDigestHour: 14 }, WED_9AM), false);
  });

  test("does not re-fire within the same matching hour as the last send", () => {
    const tenMinutesAgo = new Date(WED_9AM.getTime() - 10 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyScopedDigest({ ...base, lastBiweeklyScopedDigestSentAt: tenMinutesAgo }, WED_9AM),
      false
    );
  });

  test("does not fire again after only 7 days -- too short for biweekly's own gap", () => {
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

describe("shouldFlushQuarterlyScopedDigest (shares scopedDigestDayOfMonth, much longer gap)", () => {
  const base = { scopedDigestDayOfMonth: 7, scopedDigestHour: 9, lastQuarterlyScopedDigestSentAt: null };

  test("fires on the matching day-of-month+hour with no prior send", () => {
    assert.equal(shouldFlushQuarterlyScopedDigest(base, WED_9AM), true);
  });

  test("does not fire again after only 27 days -- that's monthly's gap, not quarterly's", () => {
    const twentySevenDaysAgo = new Date(WED_9AM.getTime() - 27 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushQuarterlyScopedDigest(
        { ...base, lastQuarterlyScopedDigestSentAt: twentySevenDaysAgo },
        WED_9AM
      ),
      false
    );
  });

  test("fires again after a full 85+ days", () => {
    const eightyFiveDaysAgo = new Date(WED_9AM.getTime() - 85 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushQuarterlyScopedDigest(
        { ...base, lastQuarterlyScopedDigestSentAt: eightyFiveDaysAgo },
        WED_9AM
      ),
      true
    );
  });

  test("not configured yet never fires", () => {
    assert.equal(shouldFlushQuarterlyScopedDigest({}, WED_9AM), false);
  });
});

// GroupMe's own schedule (see groupmeChannel.js) -- a single daily
// batch hour, independent of the email tiers above entirely. Never had
// its own schedule before this (it silently rode the old church-wide
// digest's now-retired schedule); verified here against its own
// dedicated fields.
describe("shouldFlushGroupMe", () => {
  const base = { groupmeDigestHour: 9, lastGroupmeDigestSentAt: null };

  test("not configured yet (groupmeDigestHour unset) never fires", () => {
    assert.equal(shouldFlushGroupMe({}, WED_9AM), false);
    assert.equal(shouldFlushGroupMe(null, WED_9AM), false);
  });

  test("fires on the matching hour with no prior send", () => {
    assert.equal(shouldFlushGroupMe(base, WED_9AM), true);
  });

  test("does not fire on the wrong hour", () => {
    assert.equal(shouldFlushGroupMe({ ...base, groupmeDigestHour: 14 }, WED_9AM), false);
  });

  test("does not re-fire within the same day as the last send", () => {
    const oneHourAgo = new Date(WED_9AM.getTime() - 60 * 60 * 1000);
    assert.equal(shouldFlushGroupMe({ ...base, lastGroupmeDigestSentAt: oneHourAgo }, WED_9AM), false);
  });

  test("fires again a full day later", () => {
    const yesterday = new Date(WED_9AM.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushGroupMe({ ...base, lastGroupmeDigestSentAt: yesterday }, WED_9AM), true);
  });
});
