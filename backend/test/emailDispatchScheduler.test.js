const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// emailDispatchScheduler.js transitively requires prismaClient.js (for the
// DB-touching parts of checkAndMaybeFlushEmailDispatch, not exercised by this
// file), which reads DATABASE_URL eagerly at require time -- same
// reason requireAuth.test.js needs this. The should* functions
// themselves are pure, no DB touched by anything this file actually
// calls.
require("dotenv").config({ quiet: true });
const {
  shouldFlushBiweeklyEmailDispatch,
  shouldFlushMonthlyEmailDispatch,
  shouldFlushQuarterlyEmailDispatch,
} = require("../src/utils/emailDispatchScheduler");
const { shouldFlushGroupMe } = require("../src/utils/groupmeChannel");

// Wednesday, Jan 7 2026, 9:00:00 AM local time -- day 3, date 7, hour 9.
const WED_9AM = new Date(2026, 0, 7, 9, 0, 0);

// The email digest's three cadence tiers -- weekly was retired along
// with the old church-wide batch mechanism; quarterly replaced it.
// Biweekly and monthly/quarterly each share one day field
// (emailDispatchDayOfWeek / emailDispatchDayOfMonth), told apart purely
// by each tier's own minimum-gap check against its own lastSentAt
// cursor.

describe("shouldFlushBiweeklyEmailDispatch", () => {
  const base = { emailDispatchDayOfWeek: 3, emailDispatchHour: 9, lastBiweeklyEmailDispatchSentAt: null };

  test("not configured yet (brand-new instance, no schedule set) never fires", () => {
    assert.equal(shouldFlushBiweeklyEmailDispatch({}, WED_9AM), false);
    assert.equal(shouldFlushBiweeklyEmailDispatch(null, WED_9AM), false);
    assert.equal(
      shouldFlushBiweeklyEmailDispatch({ emailDispatchDayOfWeek: 3, emailDispatchHour: null }, WED_9AM),
      false
    );
  });

  test("fires on the exact matching day+hour with no prior send", () => {
    assert.equal(shouldFlushBiweeklyEmailDispatch(base, WED_9AM), true);
  });

  test("does not fire on the wrong day or wrong hour", () => {
    assert.equal(shouldFlushBiweeklyEmailDispatch({ ...base, emailDispatchDayOfWeek: 1 }, WED_9AM), false);
    assert.equal(shouldFlushBiweeklyEmailDispatch({ ...base, emailDispatchHour: 14 }, WED_9AM), false);
  });

  test("does not re-fire within the same matching hour as the last send", () => {
    const tenMinutesAgo = new Date(WED_9AM.getTime() - 10 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyEmailDispatch({ ...base, lastBiweeklyEmailDispatchSentAt: tenMinutesAgo }, WED_9AM),
      false
    );
  });

  test("does not fire again after only 7 days -- too short for biweekly's own gap", () => {
    const sevenDaysAgo = new Date(WED_9AM.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyEmailDispatch({ ...base, lastBiweeklyEmailDispatchSentAt: sevenDaysAgo }, WED_9AM),
      false
    );
  });

  test("fires again after a full 13+ days", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushBiweeklyEmailDispatch(
        { ...base, lastBiweeklyEmailDispatchSentAt: thirteenDaysAgo },
        WED_9AM
      ),
      true
    );
  });
});

describe("shouldFlushMonthlyEmailDispatch", () => {
  const base = { emailDispatchDayOfMonth: 7, emailDispatchHour: 9, lastMonthlyEmailDispatchSentAt: null };

  test("fires on the matching day-of-month+hour, ignoring day-of-week entirely", () => {
    assert.equal(shouldFlushMonthlyEmailDispatch(base, WED_9AM), true);
  });

  test("does not fire on the wrong day-of-month", () => {
    assert.equal(shouldFlushMonthlyEmailDispatch({ ...base, emailDispatchDayOfMonth: 15 }, WED_9AM), false);
  });

  test("does not fire again after only 13 days -- that's biweekly's gap, not monthly's", () => {
    const thirteenDaysAgo = new Date(WED_9AM.getTime() - 13 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushMonthlyEmailDispatch({ ...base, lastMonthlyEmailDispatchSentAt: thirteenDaysAgo }, WED_9AM),
      false
    );
  });

  test("fires again after a full 27+ days", () => {
    const twentySevenDaysAgo = new Date(WED_9AM.getTime() - 27 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushMonthlyEmailDispatch(
        { ...base, lastMonthlyEmailDispatchSentAt: twentySevenDaysAgo },
        WED_9AM
      ),
      true
    );
  });

  test("not configured yet never fires", () => {
    assert.equal(shouldFlushMonthlyEmailDispatch({}, WED_9AM), false);
  });
});

describe("shouldFlushQuarterlyEmailDispatch (shares emailDispatchDayOfMonth, much longer gap)", () => {
  const base = { emailDispatchDayOfMonth: 7, emailDispatchHour: 9, lastQuarterlyEmailDispatchSentAt: null };

  test("fires on the matching day-of-month+hour with no prior send", () => {
    assert.equal(shouldFlushQuarterlyEmailDispatch(base, WED_9AM), true);
  });

  test("does not fire again after only 27 days -- that's monthly's gap, not quarterly's", () => {
    const twentySevenDaysAgo = new Date(WED_9AM.getTime() - 27 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushQuarterlyEmailDispatch(
        { ...base, lastQuarterlyEmailDispatchSentAt: twentySevenDaysAgo },
        WED_9AM
      ),
      false
    );
  });

  test("fires again after a full 85+ days", () => {
    const eightyFiveDaysAgo = new Date(WED_9AM.getTime() - 85 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldFlushQuarterlyEmailDispatch(
        { ...base, lastQuarterlyEmailDispatchSentAt: eightyFiveDaysAgo },
        WED_9AM
      ),
      true
    );
  });

  test("not configured yet never fires", () => {
    assert.equal(shouldFlushQuarterlyEmailDispatch({}, WED_9AM), false);
  });
});

// GroupMe's own schedule (see groupmeChannel.js) -- a single daily
// batch hour, independent of the email tiers above entirely. Never had
// its own schedule before this (it silently rode the old church-wide
// digest's now-retired schedule); verified here against its own
// dedicated fields.
describe("shouldFlushGroupMe", () => {
  const base = { chatDispatchHour: 9, lastGroupmeChatDispatchSentAt: null };

  test("not configured yet (chatDispatchHour unset) never fires", () => {
    assert.equal(shouldFlushGroupMe({}, WED_9AM), false);
    assert.equal(shouldFlushGroupMe(null, WED_9AM), false);
  });

  test("fires on the matching hour with no prior send", () => {
    assert.equal(shouldFlushGroupMe(base, WED_9AM), true);
  });

  test("does not fire on the wrong hour", () => {
    assert.equal(shouldFlushGroupMe({ ...base, chatDispatchHour: 14 }, WED_9AM), false);
  });

  test("does not re-fire within the same day as the last send", () => {
    const oneHourAgo = new Date(WED_9AM.getTime() - 60 * 60 * 1000);
    assert.equal(shouldFlushGroupMe({ ...base, lastGroupmeChatDispatchSentAt: oneHourAgo }, WED_9AM), false);
  });

  test("fires again a full day later", () => {
    const yesterday = new Date(WED_9AM.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushGroupMe({ ...base, lastGroupmeChatDispatchSentAt: yesterday }, WED_9AM), true);
  });
});
