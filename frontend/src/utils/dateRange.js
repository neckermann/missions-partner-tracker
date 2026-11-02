// Quick time-range filtering shared by the consolidated admin list pages
// (One-Time Needs, Prayer Requests, Newsletters, Documents) -- a lighter
// alternative to a full From/To picker for "what came in recently," which
// is what most look-ups on these pages actually want. The Reports page
// already offers full From/To ranges for a couple of these same record
// types when a precise range is actually needed.
export const DATE_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
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
  return true;
}
