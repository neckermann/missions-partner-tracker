// Times of day for things that happen at the church (a trip meeting) are shown in the church's own time zone
// (ChurchSettings.timezone), labelled with the zone, for everyone wherever they are. The browser's zone is never
// used: a team member travelling, or an admin in another state, would otherwise read and save a different hour.
// The server reads a time typed without a zone in the church's zone too (utils/timezone.js sets the process
// zone), so the wall-clock value an edit form shows is exactly the value it should send back.

function zoneOption(timeZone) {
  if (!timeZone) return {};
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return { timeZone };
  } catch {
    return {};
  }
}

// "Central Time", "East Africa Time": the zone's everyday name, the same in summer and winter.
function zoneLabel(date, timeZone) {
  for (const timeZoneName of ["longGeneric", "short"]) {
    try {
      const part = new Intl.DateTimeFormat("en-US", { ...zoneOption(timeZone), timeZoneName })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName");
      if (part?.value) return part.value;
    } catch {
      // An older browser without "longGeneric": fall through to the short name ("CST").
    }
  }
  return "";
}

// "Dec 1, 2026, 6:00 PM Central Time"
export function formatChurchDateTime(value, timeZone, { fallback = null } = {}) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const when = date.toLocaleString(undefined, {
    ...zoneOption(timeZone),
    dateStyle: "medium",
    timeStyle: "short",
  });
  const label = zoneLabel(date, timeZone);
  return label ? `${when} ${label}` : when;
}

// An API instant ("2026-12-02T00:00:00.000Z") as the church's wall-clock time for
// <input type="datetime-local"> ("2026-12-01T18:00"). Not value.slice(0, 16): that is the UTC hour.
export function toChurchDateTimeInputValue(value, timeZone) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...zoneOption(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// "Times are in Central Time." for a hint under a date/time box.
export function churchZoneName(timeZone, now = new Date()) {
  return zoneLabel(now, timeZone);
}
