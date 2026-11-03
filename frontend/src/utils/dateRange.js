// Quick time-range filtering shared by the consolidated admin list pages
// (One-Time Needs, Prayer Requests, Newsletters, Documents) -- a lighter
// alternative to a full From/To picker for "what came in recently," which
// is what most look-ups on these pages actually want. The Reports page's
// "Quick Range" fields (see resolveQuickRangeDates below) use this same
// preset vocabulary, now that a few reports offer it too.
import { dateOnlyParts, nowParts, lastDayOfMonth } from "./format.js";

export const DATE_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
];

// Furlough looks forward, not back -- "when's the next person leaving"
// matters more than a past month/year here, so its own Quick Range field
// uses this set instead of DATE_RANGE_OPTIONS above.
export const UPCOMING_DATE_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "year", label: "This Year" },
  { value: "nextYear", label: "Next Year" },
];

// Compares plain {year, month} integers, never a reconstructed Date -- a
// date-only API value is a UTC-midnight string, and new Date(dateValue)
// read back with a local getter silently shifts to the previous calendar
// day for anyone west of UTC. See format.js's header comment for the full
// story (this was that exact bug, caught and fixed here).
export function inDateRange(dateValue, range) {
  if (range === "all" || !dateValue) return true;
  const d = dateOnlyParts(dateValue);
  if (!d) return true;
  const now = nowParts();
  if (range === "month") {
    return d.year === now.year && d.month === now.month;
  }
  if (range === "year") {
    return d.year === now.year;
  }
  if (range === "lastYear") {
    return d.year === now.year - 1;
  }
  if (range === "nextYear") {
    return d.year === now.year + 1;
  }
  return true;
}

// Resolves a Quick Range preset into concrete from/to date strings
// (YYYY-MM-DD, matching <input type="date">) -- unlike inDateRange above,
// a client-side predicate for the list pages, a report's Quick Range field
// has to produce real boundary dates since from/to travel to the server as
// actual query params.
export function resolveQuickRangeDates(preset, now = new Date()) {
  const { year, month: m } = nowParts(now);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (y, mo, d) => `${y}-${pad(mo)}-${pad(d)}`;

  if (preset === "month") {
    return { from: fmt(year, m, 1), to: fmt(year, m, lastDayOfMonth(year, m)) };
  }
  if (preset === "year") return { from: fmt(year, 1, 1), to: fmt(year, 12, 31) };
  if (preset === "lastYear") return { from: fmt(year - 1, 1, 1), to: fmt(year - 1, 12, 31) };
  if (preset === "nextYear") return { from: fmt(year + 1, 1, 1), to: fmt(year + 1, 12, 31) };
  return { from: "", to: "" };
}
