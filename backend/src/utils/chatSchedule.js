// Shared by groupmeChannel.js and whatsappChannel.js: both post on the shared daily
// hour (ChurchSettings.chatDispatchHour), each with its own dedupe cursor.
const { mostRecentDailySlot, isSlotDue } = require("./sendSlots");
const MIN_GAP_MS_DAILY = 20 * 60 * 60 * 1000; // ~20h, not a full 24h, so a slightly-early tick never skips a day

// Pure (no I/O, no Date.now()) so it's testable with a fixed `now`, independent of host timezone.
// Due once today's send hour has passed without a send (utils/sendSlots.js), so a worker that was down at that hour, or
// a clock-change day when the hour does not exist, sends a little late instead of skipping the day.
function shouldFlushDailyChatChannel(settings, now, lastSentField) {
  if (settings?.chatDispatchHour == null) return false; // no chat schedule configured yet
  const slot = mostRecentDailySlot(now, settings.chatDispatchHour);
  return isSlotDue(slot, settings[lastSentField], MIN_GAP_MS_DAILY, now);
}

module.exports = { MIN_GAP_MS_DAILY, shouldFlushDailyChatChannel };
