// Quick time-range filtering for the admin list pages, a lighter alternative to a From/To picker.
// The Reports "Quick Range" fields (resolveQuickRangeDates below) use the same preset vocabulary.
import { dateOnlyParts, nowParts, lastDayOfMonth } from "./format.js";

export const DATE_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
];

// Furlough looks forward ("when's the next person leaving"), so it uses this set instead.
export const UPCOMING_DATE_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "year", label: "This Year" },
  { value: "nextYear", label: "Next Year" },
];

// Compares plain {year, month} integers, never a reconstructed Date: new Date(dateValue) read
// with a local getter shifts back a day west of UTC (see format.js).
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

// Resolves a Quick Range preset into from/to date strings (YYYY-MM-DD); unlike inDateRange, a
// report needs real boundary dates because from/to travel to the server as query params.
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
