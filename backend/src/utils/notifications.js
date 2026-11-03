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

async function notifyPrayerRequestCreated(prayerRequest) {
  await groupme.notifyPrayerRequestCreated(prayerRequest);
}

async function notifyPrayerRequestAnswered(prayerRequest) {
  await groupme.notifyPrayerRequestAnswered(prayerRequest);
}

async function notifySupportNeedCreated(supportNeed) {
  await groupme.notifySupportNeedCreated(supportNeed);
}

async function notifySupportNeedDecided(supportNeed) {
  await groupme.notifySupportNeedDecided(supportNeed);
}

async function notifyNewsletterCreated(newsletter) {
  await groupme.notifyNewsletterCreated(newsletter);
}

module.exports = {
  notifyPrayerRequestCreated,
  notifyPrayerRequestAnswered,
  notifySupportNeedCreated,
  notifySupportNeedDecided,
  notifyNewsletterCreated,
};
