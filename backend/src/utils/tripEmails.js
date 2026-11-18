// Shared send helper for every participant-facing email in the Trips
// feature area (#252) -- meeting invites/reschedules/reminders, the
// trip-dates team invite, the document request. Resolves the
// missing-email skip and the per-recipient try/catch in exactly one
// place, so a later fix to one of those doesn't silently miss the other
// four call sites.
const { sendEmail } = require("./email");
const { appBaseUrl, buildTripParticipantAccessToken } = require("./tripAccessToken");

// Same small "Lost your link?" line on every one of this feature's
// emails, same convention a digest email's own unsubscribe footer
// already follows elsewhere in this app. Previously promised (the plan
// always specified it here) but never actually added -- the only path
// to /trip-access-recovery was typing it directly.
function recoveryFooter() {
  return `\n\n---\nLost your link? Request a new one: ${appBaseUrl()}/trip-access-recovery`;
}

// attachments: [{ name, content (Buffer), contentType }] -- passed
// straight through to Postmark's Attachments field (base64-encoded).
async function sendParticipantEmail(participant, subject, body, { attachments, replyTo } = {}) {
  if (!participant.email) return { sent: false, reason: "no-email" };
  const fullBody = body + recoveryFooter();
  try {
    await sendEmail({
      to: participant.email,
      subject,
      text: fullBody,
      html: fullBody.replace(/\n/g, "<br>"),
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

// cancelled: true emits a METHOD:CANCEL/STATUS:CANCELLED .ics -- the
// real iCalendar-standard way to tell a calendar client to remove an
// event it already has, rather than just saying so in the email body.
// SEQUENCE increments on cancel so a client that already has the
// original (SEQUENCE:0) invite recognizes this as a newer revision of
// the same UID, not a stale duplicate -- a real reschedule (handled by
// the caller resending with the same UID and SEQUENCE:0) relies on that
// same UID match to update the existing entry rather than create a
// second one.
function buildMeetingIcs(meeting, { cancelled = false } = {}) {
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // one-hour default duration
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//missions-partner-tracker//Trips//EN",
    `METHOD:${cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:trip-meeting-${meeting.id}@missions-partner-tracker`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART:${icsDateTime(start)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${(meeting.title || "Trip meeting").replace(/\r?\n/g, " ")}`,
    meeting.location ? `LOCATION:${meeting.location.replace(/\r?\n/g, " ")}` : null,
    meeting.meetingLink ? `URL:${meeting.meetingLink}` : null,
    meeting.agenda ? `DESCRIPTION:${meeting.agenda.replace(/\r?\n/g, "\\n")}` : null,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    cancelled ? "STATUS:CANCELLED" : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// Link-based RSVP (issue #267's design decision) -- three token-
// verified GET links, same trust boundary as the existing self-service
// access link (buildTripParticipantAccessToken), reused rather than
// inventing a parallel auth mechanism. meetingId/response travel as
// plain query params (not secret -- the token is what proves this is
// really that participant); GET, not POST, since this has to work from
// a plain click in a dumb mail client with no JS involved.
function buildMeetingRsvpUrls(meeting, participant) {
  const base = appBaseUrl();
  const token = encodeURIComponent(buildTripParticipantAccessToken(participant));
  const build = (response) =>
    `${base}/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=${response}`;
  return { yes: build("yes"), no: build("no"), maybe: build("maybe") };
}

const RSVP_LABELS = { yes: "Yes", no: "No", maybe: "Maybe" };

// Shared by every meeting email (invite, reschedule-resend, explicit
// resend, day-before reminder, cancellation) so the agenda/join-link/
// RSVP-link rendering lives in exactly one place -- a church-facing
// wording tweak or a new field shouldn't require updating four
// near-duplicate email bodies in four different files.
//
// `participant` is optional -- omitted, no RSVP links render at all
// (used nowhere today, but keeps this function safe to call without one
// rather than throwing). `cancelled` suppresses links outright: there's
// nothing left to RSVP to once a meeting's been called off.
// `existingResponse` is only ever passed by the day-before reminder
// (the one email this feature sends after a participant could
// plausibly have already responded to the original invite) -- it shows
// what's on file instead of bare links, with a line underneath letting
// them still change it. The invite/reschedule/resend emails always show
// plain links with no "previously RSVP'd" framing: resending the exact
// same invite content is the simpler, more predictable choice, and
// clicking a link again is already a harmless overwrite either way.
function buildMeetingEmailBody(
  meeting,
  lead,
  participant,
  { cancelled = false, existingResponse = null } = {}
) {
  const lines = [lead];
  if (meeting.location) lines.push(`Location: ${meeting.location}`);
  if (meeting.meetingLink) lines.push(`Join online: ${meeting.meetingLink}`);
  if (meeting.agenda) lines.push(`\nAgenda:\n${meeting.agenda}`);
  if (!cancelled && participant) {
    const urls = buildMeetingRsvpUrls(meeting, participant);
    if (existingResponse) {
      lines.push(
        `\nYou previously RSVP'd: ${RSVP_LABELS[existingResponse] || existingResponse}. Changed your mind? Use a link below to update it.`
      );
    } else {
      lines.push("\nWill you be there?");
    }
    lines.push(`Yes: ${urls.yes}\nNo: ${urls.no}\nMaybe: ${urls.maybe}`);
  }
  return lines.filter(Boolean).join("\n");
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

module.exports = {
  sendParticipantEmail,
  buildMeetingIcs,
  buildMeetingEmailBody,
  buildMeetingRsvpUrls,
  buildTripDatesIcs,
};
