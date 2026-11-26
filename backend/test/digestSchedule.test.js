// When the next digest is due, and whether one reaches a person before a key date (digestSchedule.js).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { nextDigestDay, digestComesBefore } = require("../src/utils/digestSchedule");
const { reminderTier } = require("../src/utils/keyDates");

const at = (y, m, d) => new Date(y, m - 1, d, 12);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("nextDigestDay", () => {
  const settings = {
    emailDispatchDayOfWeek: 1, // Monday
    emailDispatchDayOfMonth: 15,
    emailDispatchHour: 9,
    lastBiweeklyEmailDispatchSentAt: at(2026, 11, 16), // a Monday
    lastMonthlyEmailDispatchSentAt: at(2026, 11, 15),
    lastQuarterlyEmailDispatchSentAt: null,
  };

  test("biweekly: the next Monday at least 13 days after the last send", () => {
    assert.equal(ymd(nextDigestDay("biweekly", settings, at(2026, 11, 26))), "2026-11-30");
    // Before the gap has passed, the Monday after it.
    assert.equal(
      ymd(
        nextDigestDay(
          "biweekly",
          { ...settings, lastBiweeklyEmailDispatchSentAt: at(2026, 11, 23) },
          at(2026, 11, 26)
        )
      ),
      "2026-12-07"
    );
  });

  test("monthly: the configured day of the month after the gap", () => {
    assert.equal(ymd(nextDigestDay("monthly", settings, at(2026, 11, 26))), "2026-12-15");
  });

  test("quarterly with nothing sent yet: the next configured day from today", () => {
    assert.equal(ymd(nextDigestDay("quarterly", settings, at(2026, 11, 26))), "2026-12-15");
  });

  test("null for no cadence, an unknown cadence, or no schedule set", () => {
    assert.equal(nextDigestDay(null, settings), null);
    assert.equal(nextDigestDay("weekly", settings), null);
    assert.equal(nextDigestDay("monthly", { emailDispatchHour: 9 }), null);
    assert.equal(nextDigestDay("monthly", null), null);
  });
});

describe("digestComesBefore", () => {
  const settings = {
    emailDispatchDayOfMonth: 15,
    emailDispatchHour: 9,
    lastMonthlyEmailDispatchSentAt: at(2026, 11, 15),
  };
  const now = at(2026, 11, 26);

  test("true when the next digest is on or before the date", () => {
    assert.equal(digestComesBefore("monthly", settings, "2026-12-15", now), true);
    assert.equal(digestComesBefore("monthly", settings, "2026-12-20", now), true);
  });

  test("false when the date comes first, or the person has no digest", () => {
    assert.equal(digestComesBefore("monthly", settings, "2026-12-03", now), false);
    assert.equal(digestComesBefore(null, settings, "2026-12-20", now), false);
  });
});

describe("reminderTier", () => {
  test("0 inside the final window", () => {
    assert.equal(reminderTier(7, 7, [90, 30]), 0);
    assert.equal(reminderTier(0, 7, [90, 30]), 0);
  });

  test("the smallest advance threshold that still covers it", () => {
    assert.equal(reminderTier(8, 7, [90, 30]), 30);
    assert.equal(reminderTier(30, 7, [90, 30]), 30);
    assert.equal(reminderTier(31, 7, [90, 30]), 90);
    assert.equal(reminderTier(90, 7, [90, 30]), 90);
  });

  test("null while further out than every threshold, or with none", () => {
    assert.equal(reminderTier(91, 7, [90, 30]), null);
    assert.equal(reminderTier(20, 7, []), null);
  });
});
