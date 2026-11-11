// Shared send helper for every participant-facing email in the Trips
// feature area (#252) -- meeting invites/reschedules/reminders, the
// trip-dates roster invite, the document request. Resolves the
// missing-email skip and the per-recipient try/catch in exactly one
// place, so a later fix to one of those doesn't silently miss the other
// four call sites.
const { sendEmail } = require("./email");

// attachments: [{ name, content (Buffer), contentType }] -- passed
// straight through to Postmark's Attachments field (base64-encoded).
async function sendParticipantEmail(participant, subject, body, { attachments, replyTo } = {}) {
  if (!participant.email) return { sent: false, reason: "no-email" };
  try {
    await sendEmail({
      to: participant.email,
      subject,
      text: body,
      html: body.replace(/\n/g, "<br>"),
      replyTo,
      attachments: attachments?.map((a) => ({
        Name: a.name,
        Content: a.content.toString("base64"),
        ContentType: a.contentType,
      })),
    });
    return { sent: true };
  } catch (err) {
    console.error(`Failed to email ${participant.email}:`, err.message);
    return { sent: false, reason: "send-failed" };
  }
}

// A real .ics VEVENT -- UID derived deterministically from the owning
// row's id (stable across resends, so a calendar client updates the
// existing entry rather than creating a duplicate).
function icsDateTime(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function icsDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function buildMeetingIcs(meeting) {
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // one-hour default duration
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//missions-partner-tracker//Trips//EN",
    "BEGIN:VEVENT",
    `UID:trip-meeting-${meeting.id}@missions-partner-tracker`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART:${icsDateTime(start)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${(meeting.summary || "Trip meeting").replace(/\r?\n/g, " ")}`,
    meeting.location ? `LOCATION:${meeting.location.replace(/\r?\n/g, " ")}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function buildTripDatesIcs(trip) {
  const start = new Date(trip.startDate);
  // All-day DTEND is exclusive per the iCalendar spec -- one day past the
  // real end date, not the end date itself.
  const end = new Date(trip.endDate);
  end.setDate(end.getDate() + 1);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//missions-partner-tracker//Trips//EN",
    "BEGIN:VEVENT",
    `UID:trip-dates-${trip.id}@missions-partner-tracker`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(end)}`,
    `SUMMARY:${(trip.name || trip.type || "Trip").replace(/\r?\n/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

module.exports = { sendParticipantEmail, buildMeetingIcs, buildTripDatesIcs };
