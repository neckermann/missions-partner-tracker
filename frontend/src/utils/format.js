// Date helpers. This app deals in calendar dates (a birthday, the day support takes effect), not
// instants: a calendar date has no time zone but JavaScript's Date always does, and that
// mismatch is behind the traps below. Keep date handling here, not copy-pasted per file.

// Today in the user's calendar, formatted for <input type="date">. Not toISOString().slice(0,10):
// that is the UTC date, which is tomorrow for the evening hours west of UTC. Built from local
// components so it doesn't depend on the browser's locale data.
export function todayInputValue(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// An API date ("1979-05-04T00:00:00.000Z") trimmed for <input type="date">. A string slice on
// purpose: parsing into a Date would re-read that UTC midnight in the local zone and shift it
// back a day west of UTC.
export function toDateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

// Only the year of supportingSince is shown publicly (directory and map). A plain string slice.
export function formatYear(value) {
  return value ? String(value).slice(0, 4) : null;
}

// Same string-slice approach, returning raw {year, month, day} integers for comparing or
// bucketing a calendar date without constructing a Date. month is 1-indexed; null for an
// empty/invalid value.
export function dateOnlyParts(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

// The same decomposition for "now". Reading local getters is safe here (and only in this file)
// because now is a live instant, not a reconstructed date-only value.
export function nowParts(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

// The last calendar day of a given month (1-indexed): the "day 0 of next month" trick.
export function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Date-only columns come back as UTC midnight, so `new Date(iso).toLocaleDateString()` shows the
// previous day west of UTC. Splitting Y/M/D into the local Date constructor keeps the calendar date.
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

// "$1,000": amounts are whole dollars (Int columns), so no cents. Currency is a parameter so
// forks aren't tied to USD.
export function formatCurrency(amount, { fallback = null, currency = "USD" } = {}) {
  if (amount == null) return fallback;
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
}

// "512 KB" / "2.3 MB" for an uploaded file's size.
export function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "5 November" from the month/day integers the reports API returns. Takes integers, not a date
// string, so a year-less birthday never round-trips through a Date (the timezone trap). 2001 is an
// arbitrary non-leap year used only as a formatting vehicle.
export function formatMonthDay(month, day, { locale = undefined } = {}) {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(2001, month - 1, day).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
  });
}

// Mirrors backend/src/utils/tripParticipantSchema.js isMinorForTrip exactly (age as of the trip's
// startDate, missing data means not-a-minor). Two copies because frontend and backend are
// separate runtimes: keep both in sync.
export function isMinorForTrip(dateOfBirth, tripStartDate) {
  if (!dateOfBirth || !tripStartDate) return false;
  const dob = new Date(dateOfBirth);
  const start = new Date(tripStartDate);
  let age = start.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayByStart =
    start.getUTCMonth() > dob.getUTCMonth() ||
    (start.getUTCMonth() === dob.getUTCMonth() && start.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayByStart) age--;
  return age < 18;
}

// A grant's expiry is a UTC instant meaning "through the end of this calendar day" (backend
// utils/tripAccessRules.js), so show its UTC date; local time would roll it to the next day east of UTC.
export function formatUtcDate(value, { fallback = null } = {}) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(undefined, { timeZone: "UTC" });
}
