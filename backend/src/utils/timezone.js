// Applies the church's time zone (ChurchSettings.timezone) to this process: every "what day / what hour is it"
// in the scheduled jobs reads the clock through process.env.TZ. Done at start-up and again whenever the setting
// is saved, so a change takes effect at once instead of after a restart (Node re-reads TZ when it is assigned).
// Falls back to UTC for an empty or unknown value, never throws.
function applyChurchTimezone(timezone) {
  const tz = timezone && Intl.supportedValuesOf("timeZone").includes(timezone) ? timezone : "UTC";
  process.env.TZ = tz;
  return tz;
}

module.exports = { applyChurchTimezone };
