// Channel-neutral entry points for every record-lifecycle event a route
// notifies on: a prayer request, one-time need, or newsletter being
// created, plus (#127) a prayer request getting answered or a one-time
// need getting a funding decision. Every route that notifies on an event
// calls one of the functions below, never a specific channel's notify
// function directly -- GroupMe is the only channel wired up today (see
// utils/groupme.js, which owns the actual message formatting and topic
// routing), but a future channel (an outbound email digest, etc.) for any
// of these events hooks in by adding a call here, not by editing every
// route that can trigger the event.
const groupme = require("./groupme");

// Every function below is best-effort: a broken channel must never block
// the save that triggered it. groupme.js's own notifyGroupMe() already
// catches the network call itself (a bad token, GroupMe being down); this
// is the outer layer in case something else in the pipeline throws first
// (e.g. a corrupted stored token making decryptField throw before the
// network call even happens). That outer catch used to be copy-pasted as
// a try/catch at every route call site (#135) -- centralizing it here
// means a route just calls `await notifyX(record)` and never has to think
// about it again, and it only needs writing once per future channel this
// file grows to call, not once per route.
async function safeNotify(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} notification failed:`, err);
  }
}

async function notifyPrayerRequestCreated(prayerRequest) {
  await safeNotify("Prayer request created", () => groupme.notifyPrayerRequestCreated(prayerRequest));
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await safeNotify("Prayer request answered", () => groupme.notifyPrayerRequestAnswered(prayerRequest));
}

async function notifySupportNeedCreated(supportNeed) {
  await safeNotify("Support need created", () => groupme.notifySupportNeedCreated(supportNeed));
}

async function notifySupportNeedDecided(supportNeed) {
  await safeNotify("Support need decided", () => groupme.notifySupportNeedDecided(supportNeed));
}

async function notifyNewsletterCreated(newsletter) {
  await safeNotify("Newsletter created", () => groupme.notifyNewsletterCreated(newsletter));
}

module.exports = {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
