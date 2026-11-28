// Shared send helper for every participant-facing Trips email (meeting
// invites/reschedules/reminders, trip-dates team invite, document request).
// The missing-email skip and per-recipient try/catch live here once. The
// send-orchestration functions also live here, never inline in a route file.
const prisma = require("../prismaClient");
const { loadOutboundEmailReady } = require("./emailReady");
const { sendEmail } = require("./email");
const { renderEmail, blocks } = require("./emailTemplate");
const {
  appBaseUrl,
  buildTripParticipantAccessToken,
  buildTripParticipantAccessUrl,
} = require("./tripAccessToken");

// Every function below needs only this one answer: can this site send email right now.
async function outboundEmailEnabled() {
  return loadOutboundEmailReady();
}

// What the self-gating senders return instead of silently no-op'ing when
// outboundEmail is off: enough for an admin to tell people manually, since each
// participant's trip page already shows the information.
function manualFallback(participants) {
  return {
    sent: false,
    manual: (participants || [])
      .filter((p) => p.email)
      .map((p) => ({
        name: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        email: p.email,
        url: buildTripParticipantAccessUrl(p),
      })),
  };
}

// Participant selects here are narrow on purpose: these senders read only
// email/id/accessTokenVersion, and `participants: true` would pull every column
// (the photo bytes live in their own table) just to loop over a side-effect send.
const emailParticipantSelect = { id: true, email: true, accessTokenVersion: true };

// Every email here renders through the shared branded template (emailTemplate.js)
// with a "Lost your link?" footer link.
//
// `content` is { eyebrow, blocks } (preferred) or a plain string (one paragraph).
// attachments: [{ name, content (Buffer), contentType }], passed to Postmark base64-encoded.
async function sendParticipantEmail(participant, subject, content, { attachments } = {}) {
  if (!participant.email) return { sent: false, reason: "no-email" };
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const structured = typeof content === "string" ? { blocks: [blocks.paragraph(content)] } : content;
    const message = renderEmail({
      settings,
      subject,
      eyebrow: structured.eyebrow || "Trip update",
      greetingName: participant.firstName,
      blocks: structured.blocks,
      footerLink: { label: "Lost your link? Request a new one", url: `${appBaseUrl()}/trip-access-recovery` },
    });
    await sendEmail({
      to: participant.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
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

// A real .ics VEVENT; the UID is derived from the row id so resends update the
// calendar entry instead of duplicating it.
function icsDateTime(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function icsDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

// cancelled: true emits METHOD:CANCEL/STATUS:CANCELLED so the calendar client
// removes the event. SEQUENCE increments on cancel so a client holding the
// original (SEQUENCE:0) treats it as a newer revision; a reschedule resends with
// the same UID and SEQUENCE:0 to update in place.
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

// Link-based RSVP: token-verified GET links, same trust boundary as the
// self-service access link. meetingId/response are plain query params (the token
// proves who); GET so it works from a click in a mail client with no JS.
function buildMeetingRsvpUrls(meeting, participant) {
  const base = appBaseUrl();
  const token = encodeURIComponent(buildTripParticipantAccessToken(participant));
  const build = (response) =>
    `${base}/api/public/trips/meetings/${meeting.id}/rsvp?token=${token}&response=${response}`;
  return { yes: build("yes"), no: build("no"), maybe: build("maybe") };
}

const RSVP_LABELS = { yes: "Yes", no: "No", maybe: "Maybe" };

// Shared by every meeting email so agenda/join-link/RSVP rendering lives in one
// place. `participant` is optional (no RSVP links without it). `cancelled`
// suppresses links. `existingResponse` is passed only by the day-before reminder:
// it shows what's on file with a line to change it; other emails show plain links.
function formatMeetingTime(startAt) {
  return new Date(startAt).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function buildMeetingEmailContent(
  meeting,
  lead,
  participant,
  { cancelled = false, existingResponse = null } = {}
) {
  const list = [
    blocks.paragraph(lead),
    blocks.details([
      { label: "Meeting", value: meeting.title },
      { label: "When", value: formatMeetingTime(meeting.startAt) },
      { label: "Where", value: meeting.location },
      { label: "Join online", value: meeting.meetingLink, href: meeting.meetingLink },
    ]),
  ];
  if (meeting.agenda) {
    list.push(blocks.heading("Agenda"), blocks.paragraph(meeting.agenda));
  }
  if (!cancelled && participant) {
    const urls = buildMeetingRsvpUrls(meeting, participant);
    list.push(
      blocks.paragraph(
        existingResponse
          ? `You previously RSVP'd: ${RSVP_LABELS[existingResponse] || existingResponse}. Changed your mind? Use a button below to update it.`
          : "Will you be there?"
      ),
      blocks.buttonRow([
        { url: urls.yes, label: "Yes, I'll be there" },
        { url: urls.no, label: "No" },
        { url: urls.maybe, label: "Maybe" },
      ])
    );
  }
  return { eyebrow: cancelled ? "Meeting cancelled" : "Trip meeting", blocks: list };
}

function buildTripDatesIcs(trip) {
  const start = new Date(trip.startDate);
  // All-day DTEND is exclusive per the iCalendar spec.
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

// Shared by requirement creation and the late-joiner check: the moment a
// participant first learns a document/esignature requirement applies to them.
// ("task" has no participant-facing action.) Gates and loops internally, so
// call sites need no settings check.
async function sendRequirementNotificationEmail(trip, requirement, participants) {
  if (!(await outboundEmailEnabled())) return manualFallback(participants);
  for (const participant of participants) {
    await sendParticipantEmail(participant, `New item needed: ${requirement.label}`, {
      eyebrow: "Checklist update",
      blocks: [
        blocks.paragraph(
          `A new item has been added to your checklist for ${trip.name || trip.type || "your trip"}:`
        ),
        blocks.details([{ label: "To do", value: requirement.label }]),
        blocks.button(buildTripParticipantAccessUrl(participant), "Open your trip page"),
      ],
    });
  }
  return { sent: true };
}

// Shared by both ways a participant lands on a trip with things already on it
// (direct admin add, or approved application). Sub-sends gate on outboundEmail
// themselves; this owns the exclusion for historical trips.
//
// Status alone can't detect "historical": "closed" covers both a team finalized
// for a future trip (wants catch-up) and a trip entered after the fact as a
// record (should get none). So check the trip's dates as well as status. Also
// used by sendTripDatesUpdateEmail.
function isTripHistorical(trip) {
  const referenceDate = trip.endDate || trip.startDate;
  const alreadyHappened = referenceDate && new Date(referenceDate) < new Date();
  return trip.status === "completed" || !!alreadyHappened;
}

// Background catch-up (a side effect of joining), so unlike the single-notification
// senders it deliberately returns no manual fallback: the welcome email sent
// alongside already carries the access link and its own manual-link treatment.
//
// `since`, when passed, limits this to meetings/requirements created after that
// moment, so a re-run doesn't re-send what the participant was already notified of.
async function sendLateJoinerCatchUpEmails(trip, participant, { since } = {}) {
  if (isTripHistorical(trip)) return;
  const now = new Date();
  const futureMeetings = (trip.meetings || []).filter(
    (m) => !m.cancelledAt && new Date(m.startAt) > now && (!since || new Date(m.createdAt) > since)
  );
  for (const meeting of futureMeetings) {
    await sendMeetingEmail(
      { ...trip, participants: [participant] },
      meeting,
      "A meeting has been scheduled."
    );
  }

  const notifiableRequirements = (trip.requirements || []).filter(
    (r) => (r.kind === "document" || r.kind === "esignature") && (!since || new Date(r.createdAt) > since)
  );
  for (const requirement of notifiableRequirements) {
    await sendRequirementNotificationEmail(trip, requirement, [participant]);
  }
}

// For EXISTING participants: their welcome email attached the trip-dates .ics,
// so when an admin changes startDate/endDate this resends it. The reused UID
// makes the calendar client update its entry. Returns { sent, manual } like its siblings.
async function sendTripDatesUpdateEmail(trip) {
  if (isTripHistorical(trip) || !trip.startDate || !trip.endDate) return null;
  if (!(await outboundEmailEnabled())) return manualFallback(trip.participants);
  for (const participant of trip.participants || []) {
    await sendParticipantEmail(
      participant,
      `Trip dates updated: ${trip.name || trip.type || "your trip"}`,
      {
        eyebrow: "Trip dates updated",
        blocks: [
          blocks.paragraph(
            "This trip's dates have changed -- attached is an updated calendar invite so your calendar stays accurate."
          ),
          blocks.details([
            { label: "Starts", value: new Date(trip.startDate).toDateString() },
            { label: "Ends", value: new Date(trip.endDate).toDateString() },
          ]),
          blocks.button(buildTripParticipantAccessUrl(participant), "Open your trip page"),
        ],
      },
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
  return { sent: true };
}

// Participant email with the same .ics attachment shape; cancel uses the CANCEL variant.
async function sendMeetingEmail(trip, meeting, lead, { cancelled = false } = {}) {
  if (!(await outboundEmailEnabled())) return manualFallback(trip.participants);
  // Falls back to the trip-name-only subject when a meeting has no title; otherwise
  // every meeting email of a trip would have an identical subject.
  const subjectLabel = meeting.title || trip.name || trip.type || "your trip";
  for (const participant of trip.participants) {
    await sendParticipantEmail(
      participant,
      `${cancelled ? "Meeting cancelled" : "Meeting"}: ${subjectLabel}`,
      buildMeetingEmailContent(meeting, lead, participant, { cancelled }),
      {
        attachments: [
          {
            name: "meeting.ics",
            // Same label as the email subject so the calendar entry and email read alike.
            content: Buffer.from(buildMeetingIcs({ ...meeting, title: subjectLabel }, { cancelled })),
            contentType: "text/calendar",
          },
        ],
      }
    );
  }
  return { sent: true };
}

// The participant's public support-raising page, or null while they have no share token. The same link the
// welcome email carries, so an admin can hand it over when email is off.
function buildSupportRaisingUrl(participant) {
  return participant?.shareToken ? `${appBaseUrl()}/trip-support-raising/${participant.shareToken}` : null;
}

// The "You're on the team" email, shared by both ways someone joins a trip.
// `approved` only changes the opening line.
function buildTeamWelcomeContent(trip, participant, { approved = false } = {}) {
  return {
    eyebrow: "Welcome to the team",
    blocks: [
      blocks.paragraph(
        approved
          ? "You've been approved for the trip -- attached is a calendar invite for the trip dates."
          : "You're on the team! Attached is a calendar invite for the trip dates."
      ),
      blocks.details([
        { label: "Trip", value: trip.name || trip.type },
        { label: "Starts", value: trip.startDate ? new Date(trip.startDate).toDateString() : null },
        { label: "Ends", value: trip.endDate ? new Date(trip.endDate).toDateString() : null },
      ]),
      blocks.button(buildTripParticipantAccessUrl(participant), "Open your trip page"),
      participant.shareToken
        ? blocks.paragraph("Share your support-raising page with family and friends:")
        : null,
      participant.shareToken
        ? blocks.button(buildSupportRaisingUrl(participant), "Your support-raising page")
        : null,
    ],
  };
}

module.exports = {
  sendParticipantEmail,
  buildMeetingIcs,
  buildMeetingEmailContent,
  buildTeamWelcomeContent,
  buildSupportRaisingUrl,
  buildMeetingRsvpUrls,
  buildTripDatesIcs,
  emailParticipantSelect,
  isTripHistorical,
  sendRequirementNotificationEmail,
  sendLateJoinerCatchUpEmails,
  sendTripDatesUpdateEmail,
  sendMeetingEmail,
};
