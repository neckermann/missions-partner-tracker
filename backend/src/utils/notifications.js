// Channel-neutral entry points for "an outcome was recorded" events
// (#127: a prayer request gets answered, a one-time need gets a funding
// decision). routes/prayerRequests.js and routes/supportNeeds.js call the
// functions below, not a specific channel's notify function directly --
// GroupMe is the only channel today (see utils/groupme.js), but a future
// channel (an outbound email digest, etc.) for one of these events hooks
// in by adding a call here, not by editing every route that can trigger
// the event.
//
// Creation notifications (notify*Created in groupme.js) aren't routed
// through here -- there's only ever been the one channel for those, so
// routes still call groupme.js directly for them. Move those behind this
// same layer if/when a second channel needs to react to creation too.
const groupme = require("./groupme");

async function notifyPrayerRequestAnswered(prayerRequest) {
  await groupme.notifyPrayerRequestAnswered(prayerRequest);
}

async function notifySupportNeedDecided(supportNeed) {
  await groupme.notifySupportNeedDecided(supportNeed);
}

module.exports = { notifyPrayerRequestAnswered, notifySupportNeedDecided };
