import { describe, test, expect, vi, afterEach } from "vitest";
import { todayInputValue, toDateInputValue, formatDate, formatDateLong } from "./format.js";

// These pin the two timezone traps this module exists to avoid. Both had
// shipped: one for months across ten copies of the same helper, the other
// caught earlier and fixed by hand in each of sixteen.

afterEach(() => {
  vi.useRealTimers();
});

describe("todayInputValue", () => {
  test("returns the local calendar date, not the UTC one", () => {
    // 22:30 on 2026-09-22 in California is already 2026-09-23 in UTC.
    // The old implementation -- new Date().toISOString().slice(0, 10) --
    // returned the UTC date, so every date field in the app pre-filled
    // tomorrow for the last hours of the user's day, and anyone who
    // accepted the default recorded the wrong date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T05:30:00.000Z")); // 22:30 UTC-7

    const utcDate = new Date().toISOString().slice(0, 10);
    expect(utcDate, "the UTC date really has rolled over").toBe("2026-09-23");

    // Passing the clock explicitly keeps this deterministic wherever it runs;
    // the shipped call takes no argument and uses the real one.
    const local = new Date(2026, 8, 22, 22, 30); // 22 Sept, local
    expect(todayInputValue(local)).toBe("2026-09-22");
  });

  test("pads single-digit months and days", () => {
    expect(todayInputValue(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  test("is stable at the local midnight boundary", () => {
    expect(todayInputValue(new Date(2026, 8, 22, 0, 0, 0))).toBe("2026-09-22");
    expect(todayInputValue(new Date(2026, 8, 22, 23, 59, 59))).toBe("2026-09-22");
  });
});

describe("toDateInputValue", () => {
  test("trims an API timestamp to the date the API meant", () => {
    // Deliberately a string slice. Parsing this into a Date first would
    // re-interpret the UTC midnight locally and shift it back a day.
    expect(toDateInputValue("1979-05-04T00:00:00.000Z")).toBe("1979-05-04");
  });

  test("treats missing values as empty, which is what an input wants", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("")).toBe("");
  });
});

describe("formatDate", () => {
  test("renders the stored calendar date, not the day before", () => {
    // A date-only column comes back as UTC midnight. new Date(iso) then
    // renders 3 May for anyone west of UTC.
    const naive = new Date("1979-05-04T00:00:00.000Z");
    const formatted = formatDate("1979-05-04T00:00:00.000Z");

    expect(formatted).toBe(new Date(1979, 4, 4).toLocaleDateString());
    if (naive.getDate() !== 4) {
      expect(formatted, "must not drift with the runner's timezone").not.toBe(naive.toLocaleDateString());
    }
  });

  test("returns null for a missing date so callers can hide the field", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate("")).toBeNull();
  });

  test("takes a caller-chosen fallback", () => {
    expect(formatDate(null, { fallback: "—" })).toBe("—");
  });

  test("survives a malformed value instead of rendering Invalid Date", () => {
    expect(formatDate("not-a-date")).toBeNull();
  });
});

describe("formatDateLong", () => {
  test("spells the month out", () => {
    expect(formatDateLong("1979-05-04T00:00:00.000Z")).toBe(
      new Date(1979, 4, 4).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    );
  });

  test("handles missing and malformed values the same way", () => {
    expect(formatDateLong(null)).toBeNull();
    expect(formatDateLong("nonsense")).toBeNull();
  });
});
