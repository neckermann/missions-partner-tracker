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
// routes/prayerRequests.js, routes/supportNeeds.js, routes/newsletters.js,
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

// Each event type's own ChurchSettings on/off switch (see the
// queueNotify* fields' own schema.prisma comment) -- checked fresh per
// call rather than cached, same reasoning groupme.js's old per-call
// settings lookup always had: a church can flip this mid-session and
// the very next event should respect it.
async function queueTypeEnabled(column) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { [column]: true },
  });
  // No settings row yet (brand-new instance) -- same "everything on
  // until configured otherwise" default every other queueNotify* column
  // already has at the schema level.
  return settings ? settings[column] !== false : true;
}

async function enqueue(type, partnerId, payload) {
  await prisma.pendingNotification.create({ data: { type, partnerId, payload } });
}

async function notifyPrayerRequestCreated(prayerRequest) {
  await safeNotify("Prayer request created", async () => {
    if (!(await queueTypeEnabled("queueNotifyPrayerRequests"))) return;
    await enqueue("prayerRequestCreated", prayerRequest.partnerId, {
      partnerName: prayerRequest.partner?.displayName || "A partner",
      requestText: prayerRequest.requestText,
      sourceNewsletterId: prayerRequest.sourceNewsletter?.id || null,
      sourceDocumentId: prayerRequest.sourceDocument?.id || null,
    });
  });
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await safeNotify("Prayer request answered", async () => {
    if (!(await queueTypeEnabled("queueNotifyPrayerRequests"))) return;
    await enqueue("prayerRequestAnswered", prayerRequest.partnerId, {
      partnerName: prayerRequest.partner?.displayName || "A partner",
      requestText: prayerRequest.requestText,
      answeredNote: prayerRequest.answeredNote || null,
      sourceNewsletterId: prayerRequest.sourceNewsletter?.id || null,
      sourceDocumentId: prayerRequest.sourceDocument?.id || null,
    });
  });
}

async function notifySupportNeedCreated(supportNeed) {
  await safeNotify("Support need created", async () => {
    if (!(await queueTypeEnabled("queueNotifyOneTimeNeeds"))) return;
    await enqueue("supportNeedCreated", supportNeed.partnerId, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      sourceNewsletterId: supportNeed.sourceNewsletter?.id || null,
      sourceDocumentId: supportNeed.sourceDocument?.id || null,
    });
  });
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", async () => {
    if (!(await queueTypeEnabled("queueNotifyOneTimeNeeds"))) return;
    await enqueue("supportNeedDecided", supportNeed.partnerId, {
      partnerName: supportNeed.partner?.displayName || "A partner",
      description: supportNeed.description,
      approvedAmount: supportNeed.approvedAmount,
      requestedAmount: supportNeed.requestedAmount,
      sourceNewsletterId: supportNeed.sourceNewsletter?.id || null,
      sourceDocumentId: supportNeed.sourceDocument?.id || null,
    });
  });
}

async function notifyNewsletterCreated(newsletter) {
  await safeNotify("Newsletter created", async () => {
    if (!(await queueTypeEnabled("queueNotifyNewsletters"))) return;
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
