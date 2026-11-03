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
  // vi.setSystemTime takes an absolute instant -- faking it with a UTC ISO
  // string (as an earlier version of this test did) bakes in a specific
  // real-world offset, so the local day inDateRange reads back for "now"
  // depends on whatever timezone the machine running the test happens to be
  // configured in. The local multi-arg Date constructor avoids that: it's
  // self-consistent regardless of the runner's offset, since both the fake
  // "now" and inDateRange's own reading of it resolve through the same
  // local frame of reference. Same reasoning as the `local` fixture in
  // format.test.js's todayInputValue tests.
  test("a date-only API value for the 1st of the viewer's own current month counts as 'This Month'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22)); // local: 22 Sept 2026

    // The exact shape that used to misread as the previous calendar day:
    // a date-only value stored as UTC midnight.
    expect(inDateRange("2026-09-01T00:00:00.000Z", "month")).toBe(true);
  });

  test("a date-only API value for the 1st of the viewer's own current year counts as 'This Year', not 'Last Year'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // local: 15 Jan 2026

    expect(inDateRange("2026-01-01T00:00:00.000Z", "year")).toBe(true);
    expect(inDateRange("2026-01-01T00:00:00.000Z", "lastYear")).toBe(false);
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
