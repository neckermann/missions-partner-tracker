// Scheduled reminders for Trips (#252) -- its own independent hourly cron
// registration, kept separate from emailDispatchScheduler.js/
// groupmeChannel.js, which stay scoped to the Dispatch system
// specifically. Two unrelated reminder kinds share this one file/cron
// tick since both are "trips, time-based, participant email" concerns:
// the original day-before TripMeeting reminder, and the newer
// TripRequirement due-date reminder (checklist generalization follow-on
// round). An hourly tick querying a 2-hour window guarantees every
// meeting gets caught exactly once regardless of what hour it was
// scheduled for, without needing per-minute granularity that reminder
// doesn't benefit from; the requirement reminder below doesn't need a
// window at all -- see its own comment for why.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { sendParticipantEmail, buildMeetingIcs } = require("./tripEmails");

async function checkAndSendTripMeetingReminders() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) return;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const meetings = await prisma.tripMeeting.findMany({
    where: { startAt: { gte: windowStart, lte: windowEnd }, reminderSentAt: null },
    include: { trip: { include: { participants: true } } },
  });

  for (const meeting of meetings) {
    for (const participant of meeting.trip.participants) {
      await sendParticipantEmail(
        participant,
        `Reminder: meeting tomorrow for ${meeting.trip.name || meeting.trip.type || "your trip"}`,
        `This is a reminder that your trip meeting is tomorrow${
          meeting.location ? ` at ${meeting.location}` : ""
        }.`,
        {
          attachments: [
            {
              name: "meeting.ics",
              content: Buffer.from(
                buildMeetingIcs({
                  id: meeting.id,
                  startAt: meeting.startAt,
                  location: meeting.location,
                  summary: meeting.trip.name,
                })
              ),
              contentType: "text/calendar",
            },
          ],
        }
      );
    }
    await prisma.tripMeeting.update({ where: { id: meeting.id }, data: { reminderSentAt: new Date() } });
  }
}

// TripRequirement due-date reminder -- unlike the meeting reminder above,
// this doesn't need a tight window: the gate is "on or after the
// configured lead time, but before the due date itself," which is
// already a whole-day-or-wider range, and reminderSentAt (stamped per
// participant, not per requirement -- different participants on the
// same trip can fulfill the same requirement at different times) makes
// re-checking it every hour harmless. Never fires once dueAt itself has
// arrived -- an overdue item is a different situation this round
// doesn't build a separate flow for.
async function checkAndSendRequirementReminders() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) return;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;

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
      const status = requirement.requirementStatuses.find((s) => s.participantId === participant.id);
      if (status?.reminderSentAt) continue;
      const fulfilled =
        requirement.kind === "task"
          ? !!status?.completedAt
          : requirement.documents.some((d) => d.participantId === participant.id);
      if (fulfilled) continue;

      await sendParticipantEmail(
        participant,
        `Reminder: ${requirement.label} due soon for ${requirement.trip.name || requirement.trip.type || "your trip"}`,
        `This is a reminder that "${requirement.label}" is due by ${requirement.dueAt.toISOString().slice(0, 10)}.`
      );
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
