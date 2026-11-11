// Day-before reminder for TripMeeting (#252) -- its own independent
// hourly cron registration, kept separate from emailDispatchScheduler.js/
// groupmeChannel.js, which stay scoped to the Dispatch system
// specifically. An hourly tick querying a 2-hour window guarantees every
// meeting gets caught exactly once regardless of what hour it was
// scheduled for, without needing per-minute granularity this reminder
// doesn't benefit from.
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
                buildMeetingIcs({ id: meeting.id, startAt: meeting.startAt, location: meeting.location, summary: meeting.trip.name })
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

function startTripReminderScheduler() {
  cron.schedule("0 * * * *", checkAndSendTripMeetingReminders, {
    name: "trip-meeting-reminders",
    noOverlap: true,
  });
}

module.exports = { startTripReminderScheduler, checkAndSendTripMeetingReminders };
