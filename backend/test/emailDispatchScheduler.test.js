const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// emailDispatchScheduler.js transitively requires prismaClient.js (for the DB-touching parts
// of checkAndMaybeFlushEmailDispatch, not exercised here), which reads DATABASE_URL eagerly at
// require time, as in requireAuth.test.js. The should* functions themselves are pure.
require("dotenv").config({ quiet: true });
const {
  shouldFlushBiweeklyEmailDispatch,
  shouldFlushMonthlyEmailDispatch,
  shouldFlushQuarterlyEmailDispatch,
} = require("../src/utils/emailDispatchScheduler");
const { shouldFlushGroupMe } = require("../src/utils/groupmeChannel");

// Wednesday, Jan 7 2026, 9:00:00 AM local time -- day 3, date 7, hour 9.
const WED_9AM = new Date(2026, 0, 7, 9, 0, 0);

// The email digest's three cadence tiers: biweekly, monthly and quarterly. Biweekly and
// monthly/quarterly each share one day field (emailDispatchDayOfWeek /
// emailDispatchDayOfMonth), told apart by each tier's own minimum-gap check against its own
// lastSentAt cursor.

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

// GroupMe's own schedule (see groupmeChannel.js): a single daily batch hour, independent of
// the email tiers above, with its own dedicated fields.
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

// G14c and G14d: a send is due once its most recent scheduled day and hour has passed without a send, instead of
// only when the clock reads exactly that hour. A worker that was down at the one hour, or a clock-change day with
// no 2am, now sends a little late instead of skipping the whole month (or day).
describe("catching up a missed send hour", () => {
  const monthly = (over = {}) => ({
    emailDispatchDayOfMonth: 5,
    emailDispatchHour: 9,
    lastMonthlyEmailDispatchSentAt: null,
    ...over,
  });

  test("monthly: a worker that was down at the scheduled hour sends once it is back, the same day", () => {
    const lastMonth = new Date(2025, 11, 5, 9, 2); // sent last month, on time
    const down = monthly({ lastMonthlyEmailDispatchSentAt: lastMonth });
    assert.equal(shouldFlushMonthlyEmailDispatch(down, new Date(2026, 0, 5, 8, 59)), false, "not yet");
    assert.equal(shouldFlushMonthlyEmailDispatch(down, new Date(2026, 0, 5, 11, 30)), true, "back at 11:30");
  });

  test("monthly: still sends if the worker was down for days, not skipped until next month", () => {
    const down = monthly({ lastMonthlyEmailDispatchSentAt: new Date(2025, 11, 5, 9, 2) });
    assert.equal(shouldFlushMonthlyEmailDispatch(down, new Date(2026, 0, 8, 14, 0)), true);
  });

  test("monthly: once sent for this month it does not send again that month", () => {
    const sent = monthly({ lastMonthlyEmailDispatchSentAt: new Date(2026, 0, 5, 11, 31) });
    assert.equal(shouldFlushMonthlyEmailDispatch(sent, new Date(2026, 0, 5, 11, 32)), false);
    assert.equal(shouldFlushMonthlyEmailDispatch(sent, new Date(2026, 0, 20, 9, 0)), false);
    assert.equal(
      shouldFlushMonthlyEmailDispatch(sent, new Date(2026, 1, 5, 9, 0)),
      true,
      "and the next month it does"
    );
  });

  test("a schedule that has never sent does not fire early: it waits for its next slot", () => {
    // Configured on the 20th for the 5th, never sent: not today, and not a week after the slot either.
    assert.equal(shouldFlushMonthlyEmailDispatch(monthly(), new Date(2026, 0, 20, 9, 0)), false);
    assert.equal(shouldFlushMonthlyEmailDispatch(monthly(), new Date(2026, 0, 5, 9, 0)), true, "on the slot");
    assert.equal(
      shouldFlushMonthlyEmailDispatch(monthly(), new Date(2026, 0, 5, 12, 0)),
      true,
      "a few hours late"
    );
    assert.equal(
      shouldFlushMonthlyEmailDispatch(monthly(), new Date(2026, 0, 6, 9, 0)),
      false,
      "a day late: wait"
    );
  });

  test("monthly: the 31st in a short month means that month's last day", () => {
    const s = monthly({
      emailDispatchDayOfMonth: 31,
      lastMonthlyEmailDispatchSentAt: new Date(2026, 0, 31, 9, 1),
    });
    assert.equal(shouldFlushMonthlyEmailDispatch(s, new Date(2026, 1, 27, 23, 0)), false);
    assert.equal(
      shouldFlushMonthlyEmailDispatch(s, new Date(2026, 1, 28, 9, 30)),
      true,
      "Feb 28 is its last day"
    );
  });

  test("quarterly follows the same catch-up, with its own long gap", () => {
    const q = {
      emailDispatchDayOfMonth: 5,
      emailDispatchHour: 9,
      lastQuarterlyEmailDispatchSentAt: new Date(2025, 9, 5, 9, 1),
    };
    assert.equal(shouldFlushQuarterlyEmailDispatch(q, new Date(2026, 0, 5, 13, 0)), true);
    assert.equal(
      shouldFlushQuarterlyEmailDispatch(
        { ...q, lastQuarterlyEmailDispatchSentAt: new Date(2025, 11, 5, 9, 1) },
        new Date(2026, 0, 5, 13, 0)
      ),
      false,
      "only a month after the last one: too soon"
    );
  });

  test("biweekly: a missed Wednesday hour sends the same day, and not twice", () => {
    const base = {
      emailDispatchDayOfWeek: 3,
      emailDispatchHour: 9,
      lastBiweeklyEmailDispatchSentAt: new Date(2025, 11, 24, 9, 1), // two weeks before
    };
    assert.equal(shouldFlushBiweeklyEmailDispatch(base, new Date(2026, 0, 7, 15, 0)), true);
    const done = { ...base, lastBiweeklyEmailDispatchSentAt: new Date(2026, 0, 7, 15, 1) };
    assert.equal(shouldFlushBiweeklyEmailDispatch(done, new Date(2026, 0, 7, 15, 2)), false);
    assert.equal(shouldFlushBiweeklyEmailDispatch(done, new Date(2026, 0, 8, 9, 0)), false);
  });

  test("the daily chat post goes out late rather than skipping the day, and only once", () => {
    const base = { chatDispatchHour: 9, lastGroupmeChatDispatchSentAt: new Date(2026, 0, 6, 9, 1) };
    assert.equal(shouldFlushGroupMe(base, new Date(2026, 0, 7, 12, 0)), true, "down at 9, back at noon");
    const done = { ...base, lastGroupmeChatDispatchSentAt: new Date(2026, 0, 7, 12, 1) };
    assert.equal(shouldFlushGroupMe(done, new Date(2026, 0, 7, 13, 0)), false);
    assert.equal(shouldFlushGroupMe(done, new Date(2026, 0, 8, 9, 0)), true, "and tomorrow it does");
  });

  test("the spring clock-change day, when 2am does not exist, still sends", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/Chicago"; // clocks jump from 2:00 to 3:00 on 2026-03-08
    try {
      const s = { chatDispatchHour: 2, lastGroupmeChatDispatchSentAt: new Date(2026, 2, 7, 2, 1) };
      assert.equal(
        shouldFlushGroupMe(s, new Date(2026, 2, 8, 3, 5)),
        true,
        "sent at 3:05 instead of being skipped"
      );
      const monthlyS = {
        emailDispatchDayOfMonth: 8,
        emailDispatchHour: 2,
        lastMonthlyEmailDispatchSentAt: new Date(2026, 1, 8, 2, 1),
      };
      assert.equal(shouldFlushMonthlyEmailDispatch(monthlyS, new Date(2026, 2, 8, 3, 5)), true);
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});
