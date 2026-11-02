// Quick time-range filtering shared by the consolidated admin list pages
// (One-Time Needs, Prayer Requests, Newsletters, Documents) -- a lighter
// alternative to a full From/To picker for "what came in recently," which
// is what most look-ups on these pages actually want. The Reports page's
// "Quick Range" fields (see resolveQuickRangeDates below) use this same
// preset vocabulary, now that a few reports offer it too.
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

export function inDateRange(dateValue, range) {
  if (range === "all" || !dateValue) return true;
  const d = new Date(dateValue);
  const now = new Date();
  if (range === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (range === "year") {
    return d.getFullYear() === now.getFullYear();
  }
  if (range === "lastYear") {
    return d.getFullYear() === now.getFullYear() - 1;
  }
  if (range === "nextYear") {
    return d.getFullYear() === now.getFullYear() + 1;
  }
  return true;
}

// Resolves a Quick Range preset into concrete from/to date strings
// (YYYY-MM-DD, matching <input type="date">) -- unlike inDateRange above,
// a client-side predicate for the list pages, a report's Quick Range field
// has to produce real boundary dates since from/to travel to the server as
// actual query params.
export function resolveQuickRangeDates(preset, now = new Date()) {
  const year = now.getFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-indexed here

  if (preset === "month") {
    const m = now.getMonth() + 1;
    return { from: fmt(year, m, 1), to: fmt(year, m, lastDayOfMonth(year, m)) };
  }
  if (preset === "year") return { from: fmt(year, 1, 1), to: fmt(year, 12, 31) };
  if (preset === "lastYear") return { from: fmt(year - 1, 1, 1), to: fmt(year - 1, 12, 31) };
  if (preset === "nextYear") return { from: fmt(year + 1, 1, 1), to: fmt(year + 1, 12, 31) };
  return { from: "", to: "" };
}
