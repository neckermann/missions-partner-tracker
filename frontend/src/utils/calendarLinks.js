// "Add to calendar" web links for the calendars that have a plain URL
// format (Google, Outlook personal and work/school, Yahoo). Apple
// Calendar and most other apps have no such link and still need the .ics
// file, so callers show those links alongside the .ics download, not
// instead of it.
//
// These are widely used but undocumented URL schemes, not an official
// API -- providers have changed parameter details before, so verify them
// against each provider when touching this file.
//
// Duration matches the server-side .ics (utils/tripEmails.js
// buildMeetingIcs): one hour, since meetings only store a start time.
export const DEFAULT_MEETING_MINUTES = 60;

// encodeURIComponent, not URLSearchParams: Outlook's deeplink shows a
// literal "+" for a space, so spaces must be %20.
function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// 20260304T150000Z
function compactUtc(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

// HHMM, as Yahoo's `dur` expects.
function hhmm(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}${m}`;
}

// { title, startAt, durationMinutes?, location?, description? } ->
// { google, outlook, office365, yahoo }, or null when there's no usable
// start time to build a link from.
export function buildCalendarLinks({
  title,
  startAt,
  durationMinutes = DEFAULT_MEETING_MINUTES,
  location,
  description,
}) {
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const name = title || "Trip meeting";

  const outlookParams = query({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: name,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: description,
    location,
  });

  return {
    google: `https://calendar.google.com/calendar/render?${query({
      action: "TEMPLATE",
      text: name,
      dates: `${compactUtc(start)}/${compactUtc(end)}`,
      details: description,
      location,
    })}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams}`,
    office365: `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParams}`,
    yahoo: `https://calendar.yahoo.com/?${query({
      v: 60,
      view: "d",
      type: 20,
      title: name,
      st: compactUtc(start),
      dur: hhmm(durationMinutes),
      desc: description,
      in_loc: location,
    })}`,
  };
}

// Agenda plus the join link, as the event description.
export function meetingDescription(meeting) {
  return [meeting.agenda, meeting.meetingLink ? `Join online: ${meeting.meetingLink}` : null]
    .filter(Boolean)
    .join("\n\n");
}
