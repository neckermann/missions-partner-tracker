// Shared send helper for every participant-facing email in the Trips
// feature area (#252) -- meeting invites/reschedules/reminders, the
// trip-dates team invite, the document request. Resolves the
// missing-email skip and the per-recipient try/catch in exactly one
// place, so a later fix to one of those doesn't silently miss the other
// four call sites.
//
// #271: every higher-level send-orchestration function for Trips
// (sendMeetingEmail, sendRequirementNotificationEmail,
// sendLateJoinerCatchUpEmails, sendTripDatesUpdateEmail, and the
// isTripHistorical check they share) also lives here now, not inline in
// routes/trips.js -- matching the convention every other notification
// channel in this app already follows (groupmeChannel.js,
// whatsappChannel.js, emailDispatchDelivery.js): send/notify logic goes
// in utils, never inline in a route file.
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
const { isFeatureEnabled } = require("./features");
const {
  appBaseUrl,
  buildTripParticipantAccessToken,
  buildTripParticipantAccessUrl,
} = require("./tripAccessToken");

// Every function below only ever needs this one setting -- narrower than
// a full getSettings() fetch, same narrow-select discipline the rest of
// this app already follows.
async function outboundEmailEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
}

// #274 hardening: sendRequirementNotificationEmail/sendMeetingEmail (and
// everything they call -- sendParticipantEmail, buildTripParticipantAccessUrl/
// Token, buildMeetingEmailBody/RsvpUrls) only ever read a participant's
// email/id/accessTokenVersion. The route handlers that build a trip's
// `include` before calling into these functions used to fetch
// `participants: true` (every column, including the up-to-5MB `photo`
// bytes) just to loop over them for a side-effect email send -- nothing
// in a response, so not the #274 production bug itself, but real
// avoidable memory churn on a trip with many/large participant photos.
// A `select` this narrow, not the plain `participants: true`
// tripInclude.participants now uses for its own display use-case in
// trips.js (the photo's bytes live in their own table since #274's
// hardening follow-up, so a bare `true` there no longer pulls them in
// either) -- these call sites need almost nothing else even once that's
// accounted for.
const emailParticipantSelect = { id: true, email: true, accessTokenVersion: true };

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

// Shared by the requirement-creation route and the late-joiner check in
// participant creation -- same email, two different moments a
// participant can first become aware a document- or esignature-kind
// requirement applies to them (a new one gets added to their trip, or
// they get added to a trip that already has one). Covers both kinds (not
// "task", which has no participant-facing action) with one deliberately
// generic "checklist item" wording rather than kind-specific phrasing
// ("upload"/"sign") -- it already read as kind-neutral before esignature
// was added here, so no wording change was needed, just the broader
// scope. Gates and loops internally, same shape as sendMeetingEmail just
// below, so neither call site needs its own settings check.
async function sendRequirementNotificationEmail(trip, requirement, participants) {
  if (!(await outboundEmailEnabled())) return;
  for (const participant of participants) {
    await sendParticipantEmail(
      participant,
      `New item needed: ${requirement.label}`,
      `A new item has been added to your checklist for ${trip.name || trip.type || "your trip"}: "${requirement.label}".\n\nYour trip page: ${buildTripParticipantAccessUrl(participant)}`
    );
  }
}

// Shared by both ways a participant can land on a trip after other
// things already exist on it -- a direct admin add (POST
// /:id/participants) or an approved application (PUT /applications/:id,
// a separate code path with its own tx.tripParticipant.create). Both
// used to only backfill this for the direct-add path; approval got
// nothing, despite being the more common real-world way someone becomes
// a participant. Both sub-sends already gate on outboundEmail internally
// (sendMeetingEmail/sendRequirementNotificationEmail each check it
// themselves), so this only needs to own the one cross-cutting exclusion
// both call sites already applied: a backfilled participant doesn't need
// catch-up notifications for things that already happened or never will.
//
// "completed" alone isn't enough to detect that, though -- "closed"
// covers two different real situations that share the same status
// string: a team finalized for a trip that hasn't happened yet (still
// wants catch-up), and a trip entered after the fact purely as a
// historical record (should get none, same as "completed", despite never
// being marked that). Status can't tell those apart; the trip's own
// dates can -- so check both signals, not just status, rather than
// replacing one with the other. Shared with sendTripDatesUpdateEmail
// below, which needs the exact same exclusion for the same reason (a
// historical-record trip shouldn't get a "dates changed" email either).
function isTripHistorical(trip) {
  const referenceDate = trip.endDate || trip.startDate;
  const alreadyHappened = referenceDate && new Date(referenceDate) < new Date();
  return trip.status === "completed" || !!alreadyHappened;
}

async function sendLateJoinerCatchUpEmails(trip, participant) {
  if (isTripHistorical(trip)) return;
  const now = new Date();
  const futureMeetings = (trip.meetings || []).filter((m) => !m.cancelledAt && new Date(m.startAt) > now);
  for (const meeting of futureMeetings) {
    await sendMeetingEmail(
      { ...trip, participants: [participant] },
      meeting,
      "A meeting has been scheduled."
    );
  }

  const notifiableRequirements = (trip.requirements || []).filter(
    (r) => r.kind === "document" || r.kind === "esignature"
  );
  for (const requirement of notifiableRequirements) {
    await sendRequirementNotificationEmail(trip, requirement, [participant]);
  }
}

// A different gap than the late-joiner one above: an EXISTING
// participant, not a new one. Every participant's welcome email attaches
// the trip-dates .ics at the moment they join (buildTripDatesIcs, same
// UID-per-trip convention as buildMeetingIcs) -- but if an admin later
// changes startDate/endDate, nothing resent that .ics, so every
// participant who already joined kept a calendar entry with the old,
// now-wrong dates. The reused UID means a calendar client updates its
// existing entry rather than creating a duplicate one, exactly as a
// meeting reschedule's resend already relies on for the same reason.
async function sendTripDatesUpdateEmail(trip) {
  if (isTripHistorical(trip) || !trip.startDate || !trip.endDate) return;
  if (!(await outboundEmailEnabled())) return;
  for (const participant of trip.participants || []) {
    await sendParticipantEmail(
      participant,
      `Trip dates updated: ${trip.name || trip.type || "your trip"}`,
      `This trip's dates have changed -- attached is an updated calendar invite.\n\nYour trip page: ${buildTripParticipantAccessUrl(participant)}`,
      {
        attachments: [
          {
            name: "trip-dates.ics",
            content: Buffer.from(buildTripDatesIcs(trip)),
            contentType: "text/calendar",
          },
        ],
      }
    );
  }
}

// participant email with the same .ics attachment shape, just a
// different lead sentence and (for cancel) the CANCEL variant.
async function sendMeetingEmail(trip, meeting, lead, { cancelled = false } = {}) {
  if (!(await outboundEmailEnabled())) return;
  // Falls back to exactly today's trip-name-only subject when a meeting
  // has no title set -- a trip with more than one meeting (the normal
  // case) otherwise sends every meeting's email with the identical
  // subject line, indistinguishable in an inbox until opened.
  const subjectLabel = meeting.title || trip.name || trip.type || "your trip";
  for (const participant of trip.participants) {
    await sendParticipantEmail(
      participant,
      `${cancelled ? "Meeting cancelled" : "Meeting"}: ${subjectLabel}`,
      buildMeetingEmailBody(meeting, lead, participant, { cancelled }),
      {
        attachments: [
          {
            name: "meeting.ics",
            // Same resolved label as the email subject above -- the
            // calendar entry's own title and the email that delivered it
            // should always read as the same thing, not drift apart.
            content: Buffer.from(buildMeetingIcs({ ...meeting, title: subjectLabel }, { cancelled })),
            contentType: "text/calendar",
          },
        ],
      }
    );
  }
}

module.exports = {
  sendParticipantEmail,
  buildMeetingIcs,
  buildMeetingEmailBody,
  buildMeetingRsvpUrls,
  buildTripDatesIcs,
  emailParticipantSelect,
  isTripHistorical,
  sendRequirementNotificationEmail,
  sendLateJoinerCatchUpEmails,
  sendTripDatesUpdateEmail,
  sendMeetingEmail,
};
