// The actual flush logic for the batched notification queue (see #129)
// -- extracted into its own util rather than living inside
// routes/notifications.js, since both that route's manual "Send Pending
// Notifications" button and utils/digestScheduler.js's own automatic
// flush need to call the exact same logic, and routes/ in this app are
// thin HTTP handlers over utils/, never the other way around.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./notificationBlurbs");
const { sendPendingNotificationsBatch } = require("./groupme");
const { sendPendingNotificationsDigest } = require("./emailDigest");

// Attempts whichever channels are currently enabled, independently --
// see the PendingNotification schema.prisma comment for the full
// per-channel-success reasoning (a channel that's off never blocks a
// row's deletion; a channel whose send failed leaves that row queued
// for the next flush without touching a channel that already
// succeeded).
async function flushPendingNotifications() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const groupmeOn = isFeatureEnabled(settings?.enabledFeatures, "groupme");
  const emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");

  const rows = await prisma.pendingNotification.findMany({
    where: { OR: [{ groupmeSentAt: null }, { emailSentAt: null }] },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return { sent: 0, remaining: 0 };

  // Read fresh, not from each row's own frozen payload -- isRestricted
  // can change after a notification was already queued, and buildBlurb
  // needs the current value to mask correctly (see notificationBlurbs.js).
  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, displayName: true, isRestricted: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const blurbById = new Map(
    rows.map((row) => [row.id, buildBlurb(row, partnerById.get(row.partnerId))]).filter(([, blurb]) => blurb)
  );

  if (groupmeOn) {
    const candidates = rows
      .filter((row) => !row.groupmeSentAt)
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (candidates.length > 0) {
      const sentIds = await sendPendingNotificationsBatch(candidates);
      if (sentIds.size > 0) {
        await prisma.pendingNotification.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { groupmeSentAt: new Date() },
        });
      }
    }
  }

  if (emailOn) {
    const candidates = rows
      .filter((row) => !row.emailSentAt)
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (candidates.length > 0) {
      const ran = await sendPendingNotificationsDigest(candidates);
      if (ran) {
        await prisma.pendingNotification.updateMany({
          where: { id: { in: candidates.map((blurb) => blurb.id) } },
          data: { emailSentAt: new Date() },
        });
      }
    }
  }

  // Re-read current sent-state (the updateMany calls above already
  // wrote it) to decide what's now fully cleared.
  const refreshed = await prisma.pendingNotification.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: { id: true, groupmeSentAt: true, emailSentAt: true },
  });
  // (groupmeOn || emailOn) guards against the vacuous case where neither
  // channel is on: without it, every "!channelOn" half below is trivially
  // true and a row would get deleted having never been sent anywhere.
  const clearableIds = refreshed
    .filter(
      (row) => (groupmeOn || emailOn) && (!groupmeOn || row.groupmeSentAt) && (!emailOn || row.emailSentAt)
    )
    .map((row) => row.id);
  if (clearableIds.length > 0) {
    await prisma.pendingNotification.deleteMany({ where: { id: { in: clearableIds } } });
  }

  return { sent: clearableIds.length, remaining: rows.length - clearableIds.length };
}

module.exports = { flushPendingNotifications };
