import { describe, test, expect, vi, afterEach } from "vitest";
import { inDateRange, resolveQuickRangeDates } from "./dateRange.js";

// This pins the exact bug that kept recurring: inDateRange used to build
// `new Date(dateValue)` and read it back with local getters, which
// misreads a date-only API value (UTC midnight) as the previous calendar
// day for anyone west of UTC. See format.js's header comment for the full
// story.

afterEach(() => {
  vi.useRealTimers();
});

describe("inDateRange", () => {
  test("a record received on the 1st still counts as 'This Month' from a UTC-negative zone", () => {
    // 22:30 on 2026-09-22 in California is already 2026-09-23 in UTC -- the
    // same boundary format.test.js pins todayInputValue against.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T05:30:00.000Z")); // 22:30 UTC-7, local date is Sept 22

    // A date-only API value for the 1st of the viewer's own current month,
    // stored as UTC midnight.
    expect(inDateRange("2026-09-01T00:00:00.000Z", "month")).toBe(true);
  });

  test("a record received on the 1st still counts as 'This Year' from a UTC-negative zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:30:00.000Z")); // 22:30 UTC-7 on Dec 31, local date

    expect(inDateRange("2025-12-01T00:00:00.000Z", "year")).toBe(true);
    expect(inDateRange("2025-12-01T00:00:00.000Z", "lastYear")).toBe(false);
  });

  test("'all' and a missing value always match", () => {
    expect(inDateRange(null, "month")).toBe(true);
    expect(inDateRange("2026-01-01T00:00:00.000Z", "all")).toBe(true);
  });

  test("lastYear/nextYear classify relative to the viewer's own current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));

    expect(inDateRange("2025-06-15T00:00:00.000Z", "lastYear")).toBe(true);
    expect(inDateRange("2027-06-15T00:00:00.000Z", "nextYear")).toBe(true);
    expect(inDateRange("2026-06-15T00:00:00.000Z", "lastYear")).toBe(false);
  });
});

describe("resolveQuickRangeDates", () => {
  test("'month' resolves to the viewer's own current month's real boundaries", () => {
    const now = new Date(2026, 1, 10); // 10 Feb 2026, local
    expect(resolveQuickRangeDates("month", now)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("handles a leap-year February correctly", () => {
    const now = new Date(2024, 1, 10);
    expect(resolveQuickRangeDates("month", now)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  test("'year'/'lastYear'/'nextYear' resolve relative to the viewer's own current year", () => {
    const now = new Date(2026, 5, 15);
    expect(resolveQuickRangeDates("year", now)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(resolveQuickRangeDates("lastYear", now)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(resolveQuickRangeDates("nextYear", now)).toEqual({ from: "2027-01-01", to: "2027-12-31" });
  });

  test("'all' and anything unrecognized return empty bounds", () => {
    expect(resolveQuickRangeDates("all")).toEqual({ from: "", to: "" });
  });
});
