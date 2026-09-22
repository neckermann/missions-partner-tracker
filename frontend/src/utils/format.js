// Date helpers, in one place.
//
// Everything here exists because this app deals in *calendar dates* --
// a birthday, the day a newsletter arrived, the date support takes effect --
// not in instants. A calendar date has no time zone, but JavaScript's Date
// always does, and that mismatch is where both bugs below came from.
//
// These were previously copy-pasted: `formatDate` was defined in 16 files
// and `todayInputValue` in 10. That is not just repetition -- it means a fix
// applied to one copy silently doesn't reach the other fifteen, which is
// exactly what happened with the bug described next.

// Today, as the *user's calendar* sees it, formatted for <input type="date">.
//
// The previous implementation was `new Date().toISOString().slice(0, 10)`,
// which is the date in UTC. For anyone west of UTC that is tomorrow's date
// for the last hours of their day -- from 5pm in California, every date
// field in the app pre-filled the wrong day, and whoever accepted the
// default recorded a support entry or prayer request dated tomorrow.
//
// Built from local components rather than a locale format, so it can't
// depend on which locale data the browser happens to ship.
export function todayInputValue(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// An API date ("1979-05-04T00:00:00.000Z") trimmed to what <input
// type="date"> wants. Deliberately a string slice: parsing it into a Date
// first would re-interpret that UTC midnight in the local zone and shift it
// back a day west of UTC.
export function toDateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

// The same trap in the other direction. Date-only columns come back as UTC
// midnight, so `new Date(isoString).toLocaleDateString()` renders the
// previous day for anyone west of UTC. Splitting the Y/M/D out and handing
// them to the local-time Date constructor keeps it the calendar date it is.
function toLocalDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

// "5/4/1979" -- for tables and lists, where space is tight.
export function formatDate(value, { fallback = null } = {}) {
  if (!value) return fallback;
  const date = toLocalDate(value);
  return date ? date.toLocaleDateString() : fallback;
}

// "4 May 1979" -- for detail pages and the printed booklet, where the
// unambiguous form is worth the extra width.
export function formatDateLong(value, { fallback = null } = {}) {
  if (!value) return fallback;
  const date = toLocalDate(value);
  return date
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : fallback;
}
