// Scheduled Trips reminders: an independent hourly cron, separate from the
// Dispatch schedulers. It holds two time-based participant-email reminders: the
// day-before TripMeeting reminder and the TripRequirement due-date reminder. An
// hourly tick over a 2-hour window catches every meeting exactly once whatever
// its scheduled hour; the requirement reminder needs no window (see below).
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { isDemoInstance } = require("./demoMode");
const { isFeatureEnabled } = require("./features");
const { sendParticipantEmail, buildMeetingIcs, buildMeetingEmailContent } = require("./tripEmails");
const { isMinorForTrip } = require("./tripParticipantSchema");
const { blocks } = require("./emailTemplate");
const { buildTripParticipantAccessUrl } = require("./tripAccessToken");

async function checkAndSendTripMeetingReminders() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) return;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  if (await isDemoInstance()) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // cancelledAt: null: a cancelled meeting already got its cancellation notice.
  const meetings = await prisma.tripMeeting.findMany({
    where: { startAt: { gte: windowStart, lte: windowEnd }, reminderSentAt: null, cancelledAt: null },
    include: { trip: { include: { participants: true } }, rsvps: true },
  });

  for (const meeting of meetings) {
    // Keyed by participantId: the reminder shows an existing RSVP instead of bare
    // links (see buildMeetingEmailContent).
    const rsvpByParticipantId = new Map(meeting.rsvps.map((r) => [r.participantId, r.response]));
    let sent = 0;
    let failed = 0;
    for (const participant of meeting.trip.participants) {
      const result = await sendParticipantEmail(
        participant,
        `Reminder: meeting tomorrow for ${meeting.trip.name || meeting.trip.type || "your trip"}`,
        buildMeetingEmailContent(
          meeting,
          "This is a reminder that your trip meeting is tomorrow.",
          participant,
          {
            existingResponse: rsvpByParticipantId.get(participant.id) || null,
          }
        ),
        {
          attachments: [
            {
              name: "meeting.ics",
              content: Buffer.from(buildMeetingIcs({ ...meeting, summary: meeting.trip.name })),
              contentType: "text/calendar",
            },
          ],
        }
      );
      if (result.sent) sent += 1;
      else if (result.reason === "send-failed") failed += 1;
    }
    // Every send failed (a provider outage, say): leave the meeting unmarked so the next hourly tick, still
    // inside the 2-hour window, tries again. If at least one went out, or nobody had an address to send to,
    // it is marked as before, so a part-way failure is never resent to the people who already got it.
    if (failed > 0 && sent === 0) {
      console.error(`Meeting reminder for ${meeting.id}: every send failed, will retry on the next tick.`);
      continue;
    }
    await prisma.tripMeeting.update({ where: { id: meeting.id }, data: { reminderSentAt: new Date() } });
  }
}

// TripRequirement due-date reminder. Needs no tight window: the gate is "on or
// after the configured lead time, before the due date", and reminderSentAt
// (stamped per participant, since they fulfil it at different times) makes hourly
// re-checks harmless. Never fires once dueAt has arrived; overdue is a different situation.
async function checkAndSendRequirementReminders() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) return;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  if (await isDemoInstance()) return;

  const now = new Date();
  const requirements = await prisma.tripRequirement.findMany({
    where: { dueAt: { not: null }, reminderLeadDays: { not: null } },
    include: { trip: { include: { participants: true } }, documents: true, requirementStatuses: true },
  });

  for (const requirement of requirements) {
    const reminderAt = new Date(requirement.dueAt);
    reminderAt.setUTCDate(reminderAt.getUTCDate() - requirement.reminderLeadDays);
    if (now < reminderAt || now >= requirement.dueAt) continue;

    for (const participant of requirement.trip.participants) {
      // A minors-only requirement never reminds a non-minor.
      if (requirement.minorsOnly && !isMinorForTrip(participant.dateOfBirth, requirement.trip.startDate)) {
        continue;
      }
      const status = requirement.requirementStatuses.find((s) => s.participantId === participant.id);
      if (status?.reminderSentAt) continue;
      const fulfilled =
        requirement.kind === "task"
          ? !!status?.completedAt
          : requirement.documents.some((d) => d.participantId === participant.id);
      if (fulfilled) continue;

      const result = await sendParticipantEmail(
        participant,
        `Reminder: ${requirement.label} due soon for ${requirement.trip.name || requirement.trip.type || "your trip"}`,
        {
          eyebrow: "Reminder",
          blocks: [
            blocks.paragraph("This is a friendly reminder that an item on your trip checklist is due soon."),
            blocks.details([
              { label: "To do", value: requirement.label },
              { label: "Due", value: requirement.dueAt.toISOString().slice(0, 10) },
            ]),
            blocks.button(buildTripParticipantAccessUrl(participant), "Open your trip page"),
          ],
        }
      );
      // A failed send is not marked, so the next hourly check tries again.
      if (!result.sent && result.reason === "send-failed") continue;
      await prisma.tripRequirementStatus.upsert({
        where: {
          requirementId_participantId: { requirementId: requirement.id, participantId: participant.id },
        },
        create: { requirementId: requirement.id, participantId: participant.id, reminderSentAt: new Date() },
        update: { reminderSentAt: new Date() },
      });
    }
  }
}

function startTripReminderScheduler() {
  cron.schedule("0 * * * *", checkAndSendTripMeetingReminders, {
    name: "trip-meeting-reminders",
    noOverlap: true,
  });
  cron.schedule("0 * * * *", checkAndSendRequirementReminders, {
    name: "trip-requirement-reminders",
    noOverlap: true,
  });
}

module.exports = {
  startTripReminderScheduler,
  checkAndSendTripMeetingReminders,
  checkAndSendRequirementReminders,
};
