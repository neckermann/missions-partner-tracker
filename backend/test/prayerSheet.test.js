// The Sunday prayer sheet's rotation: which group of partners belongs on a given date's sheet. Worked out from the
// date alone, so the same date always gives the same sheet, and over a month everyone appears once.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
// utils/prayerSheet.js requires prismaClient.js, which reads DATABASE_URL when it is required.
require("dotenv").config({ quiet: true });
const { sheetGroup, partnersForGroup, isValidDay } = require("../src/utils/prayerSheet");

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const people = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    displayName: `Partner ${String.fromCharCode(65 + i)}`,
  }));

describe("sheetGroup", () => {
  test("weekly: four groups, one per week, in order", () => {
    const indexes = ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25", "2026-02-01"].map(
      (d) => sheetGroup(d, "weekly").index
    );
    assert.deepEqual(indexes, [0, 1, 2, 3, 0]);
    assert.equal(sheetGroup("2026-01-04", "weekly").count, 4);
  });

  test("any day in a week gives that week's group", () => {
    for (let day = 0; day < 7; day += 1)
      assert.equal(sheetGroup(addDays("2026-01-04", day), "weekly").index, 0);
    assert.equal(sheetGroup("2026-01-11", "weekly").index, 1);
  });

  test("dates before the start of the rotation still work", () => {
    assert.equal(sheetGroup("2025-12-28", "weekly").index, 3);
    assert.equal(sheetGroup("2025-12-21", "weekly").index, 2);
  });

  test("biweekly: two groups, a new one every two weeks", () => {
    const indexes = ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25", "2026-02-01"].map(
      (d) => sheetGroup(d, "biweekly").index
    );
    assert.deepEqual(indexes, [0, 0, 1, 1, 0]);
    assert.equal(sheetGroup("2026-01-04", "biweekly").count, 2);
  });

  test("monthly: one group, everyone, whatever the date", () => {
    for (const d of ["2026-01-04", "2026-03-15", "2027-12-31"]) {
      assert.deepEqual(sheetGroup(d, "monthly"), { index: 0, count: 1 });
    }
  });

  test("an unknown cadence is an error, not a silent default", () => {
    assert.throws(() => sheetGroup("2026-01-04", "daily"));
  });
});

describe("partnersForGroup", () => {
  test("the groups together are everyone, once, and as even as they can be", () => {
    const all = people(10);
    const groups = [0, 1, 2, 3].map((index) => partnersForGroup(all, { index, count: 4 }));
    assert.deepEqual(
      groups.map((g) => g.length),
      [3, 3, 2, 2]
    );
    assert.deepEqual(
      groups
        .flat()
        .map((p) => p.id)
        .sort(),
      all.map((p) => p.id).sort()
    );
  });

  test("the same people always split the same way, whatever order they arrive in", () => {
    const all = people(9);
    const shuffled = [...all].reverse();
    for (let index = 0; index < 4; index += 1) {
      assert.deepEqual(
        partnersForGroup(shuffled, { index, count: 4 }).map((p) => p.id),
        partnersForGroup(all, { index, count: 4 }).map((p) => p.id)
      );
    }
  });

  test("with fewer partners than groups some sheets are empty, and nobody is lost", () => {
    const all = people(2);
    const sizes = [0, 1, 2, 3].map((index) => partnersForGroup(all, { index, count: 4 }).length);
    assert.deepEqual(sizes, [1, 1, 0, 0]);
  });
});

describe("over a month everyone is prayed for once", () => {
  const all = people(13);
  const seen = (cadence, sheets, stepDays) => {
    const ids = [];
    for (let i = 0; i < sheets; i += 1) {
      const group = sheetGroup(addDays("2026-03-01", i * stepDays), cadence);
      ids.push(...partnersForGroup(all, group).map((p) => p.id));
    }
    return ids.sort();
  };
  const everyone = all.map((p) => p.id).sort();

  test("weekly: four consecutive Sundays cover everyone exactly once", () => {
    assert.deepEqual(seen("weekly", 4, 7), everyone);
  });
  test("biweekly: two consecutive sheets cover everyone exactly once", () => {
    assert.deepEqual(seen("biweekly", 2, 14), everyone);
  });
  test("monthly: the one sheet is everyone", () => {
    assert.deepEqual(seen("monthly", 1, 28), everyone);
  });
});

describe("isValidDay", () => {
  test("accepts a real day and refuses the rest", () => {
    assert.equal(isValidDay("2026-12-06"), true);
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "26-12-06",
      "tomorrow",
      "",
      null,
      undefined,
      "2026-12-06T00:00",
    ]) {
      assert.equal(isValidDay(bad), false, String(bad));
    }
  });
});
