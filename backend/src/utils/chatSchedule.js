// Shared by groupmeChannel.js and whatsappChannel.js: both post on the
// same shared daily hour (ChurchSettings.groupmeDigestHour -- the column
// keeps its GroupMe-specific name so forks upgrade without a rename; see
// schema.prisma's own comment on it), each with its own dedupe cursor.
// Extracted once both channels' own copies of this exact check started
// drifting apart only in which cursor field they read -- a future fix
// to the gap rule (DST handling, a different minimum gap) now only
// needs to land in one place.
const MIN_GAP_MS_DAILY = 20 * 60 * 60 * 1000; // ~20h, not a full 24h, so a slightly-early tick never skips a day

// Pure (no I/O, no Date.now()) so it's directly unit-testable with a
// fixed `now`, independent of the host machine's actual timezone.
function shouldFlushDailyChatChannel(settings, now, lastSentField) {
  if (settings?.groupmeDigestHour == null) return false; // no chat schedule configured yet
  if (now.getHours() !== settings.groupmeDigestHour) return false;
  const sinceLast = settings[lastSentField] ? now - settings[lastSentField] : Infinity;
  return sinceLast >= MIN_GAP_MS_DAILY;
}

module.exports = { MIN_GAP_MS_DAILY, shouldFlushDailyChatChannel };
