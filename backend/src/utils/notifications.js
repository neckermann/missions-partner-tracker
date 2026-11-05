// Channel-neutral entry points for every record-lifecycle event a route
// notifies on: a prayer request, one-time need, or newsletter being
// created, plus (#127) a prayer request getting answered or a one-time
// need getting a funding decision. Every route that notifies on an event
// calls one of the functions below, never a specific channel's notify
// function directly.
//
// As of #129, these write a PendingNotification row instead of posting
// live -- GroupMe and the (future, as of this writing) email digest
// channel both read from that same queue and flush it together on a
// schedule or a manual "Send Pending Notifications" action (see
// routes/notifications.js, utils/groupme.js's sendPendingNotificationsBatch,
// utils/emailDigest.js). This file staying the one place every route
// calls is exactly what made that swap possible without touching
// routes/prayerRequests.js, routes/supportNeeds.js, routes/partnerFiles.js,
// or routes/inboundEmail.js at all -- a future channel still hooks in by
// adding a call in the flush logic, not by editing every route that can
// trigger an event.
const prisma = require("../prismaClient");

// Every function below is best-effort: a broken queue write must never
// block the save that triggered it (a corrupted ChurchSettings row, a
// transient DB hiccup -- rare, but the save itself must survive it
// regardless). Same reasoning/shape as this file had pre-#129, just
// wrapping a Prisma write now instead of a network call.
async function safeNotify(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed:`, err);
  }
}

// Each event type's own ChurchSettings on/off switch, plus the
// cross-cutting queueNotifyRestrictedPartners switch (#187) -- checked
// fresh per call rather than cached, same reasoning groupme.js's old
// per-call settings lookup always had: a church can flip either mid-
// session and the very next event should respect it. The restricted-
// partner check only runs its own extra query when that switch is
// actually off (the common default-on case adds no round trip over what
// this already did).
async function shouldQueue(column, partnerId) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { [column]: true, queueNotifyRestrictedPartners: true },
  });
  // No settings row yet (brand-new instance) -- same "everything on
  // until configured otherwise" default every other queueNotify* column
  // already has at the schema level.
  if (settings && settings[column] === false) return false;
  if (settings && settings.queueNotifyRestrictedPartners === false) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { isRestricted: true },
    });
    if (partner?.isRestricted) return false;
  }
  return true;
}

async function enqueue(type, partnerId, payload) {
  await prisma.pendingNotification.create({ data: { type, partnerId, payload } });
}

async function notifyPrayerRequestCreated(prayerRequest) {
  await safeNotify("Prayer request created", async () => {
    if (!(await shouldQueue("queueNotifyPrayerRequests", prayerRequest.partnerId))) return;
    await enqueue("prayerRequestCreated", prayerRequest.partnerId, {
      partnerName: prayerRequest.partner?.displayName || "A partner",
      requestText: prayerRequest.requestText,
      sourceFileId: prayerRequest.sourceFile?.id || null,
    });
  });
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await safeNotify("Prayer request answered", async () => {
    if (!(await shouldQueue("queueNotifyPrayerRequests", prayerRequest.partnerId))) return;
    await enqueue("prayerRequestAnswered", prayerRequest.partnerId, {
      partnerName: prayerRequest.partner?.displayName || "A partner",
      requestText: prayerRequest.requestText,
      answeredNote: prayerRequest.answeredNote || null,
      sourceFileId: prayerRequest.sourceFile?.id || null,
    });
  });
}

async function notifySupportNeedCreated(supportNeed) {
  await safeNotify("Support need created", async () => {
    if (!(await shouldQueue("queueNotifyOneTimeNeeds", supportNeed.partnerId))) return;
    await enqueue("supportNeedCreated", supportNeed.partnerId, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      sourceFileId: supportNeed.sourceFile?.id || null,
    });
  });
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", async () => {
    if (!(await shouldQueue("queueNotifyOneTimeNeeds", supportNeed.partnerId))) return;
    await enqueue("supportNeedDecided", supportNeed.partnerId, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      approvedAmount: supportNeed.approvedAmount,
      requestedAmount: supportNeed.requestedAmount,
      sourceFileId: supportNeed.sourceFile?.id || null,
    });
  });
}

async function notifyNewsletterCreated(newsletter) {
  await safeNotify("Newsletter created", async () => {
    if (!(await shouldQueue("queueNotifyNewsletters", newsletter.partnerId))) return;
    await enqueue("newsletterCreated", newsletter.partnerId, {
      partnerName: newsletter.partner?.displayName || "A partner",
      newsletterId: newsletter.id,
    });
  });
}

module.exports = {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
