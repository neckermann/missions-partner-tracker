// Shared by groupmeChannel.js and whatsappChannel.js: both post on the shared daily
// hour (ChurchSettings.chatDispatchHour), each with its own dedupe cursor.
const MIN_GAP_MS_DAILY = 20 * 60 * 60 * 1000; // ~20h, not a full 24h, so a slightly-early tick never skips a day

// Pure (no I/O, no Date.now()) so it's testable with a fixed `now`, independent of host timezone.
function shouldFlushDailyChatChannel(settings, now, lastSentField) {
  if (settings?.chatDispatchHour == null) return false; // no chat schedule configured yet
  if (now.getHours() !== settings.chatDispatchHour) return false;
  const sinceLast = settings[lastSentField] ? now - settings[lastSentField] : Infinity;
  return sinceLast >= MIN_GAP_MS_DAILY;
}

module.exports = { MIN_GAP_MS_DAILY, shouldFlushDailyChatChannel };
