// Resolves the "today" every report's run() receives: a Date at UTC midnight
// representing a calendar day (see reports/index.js for why consumers use UTC
// getters). Pure and Express-free so it can be tested with an injected `now`.
function resolveToday(queryToday, now = new Date()) {
  if (queryToday) return new Date(queryToday);
  // No browser-supplied day: use today in the church's timezone (process.env.TZ,
  // set from ChurchSettings.timezone at startup) re-encoded as UTC midnight, the
  // same shape as the browser-supplied path.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// "Today" for a job or a bell alert that has no browser to ask: the calendar day in the church's own time
// zone, as a Date at UTC midnight (the shape the key-date and report code expects). Taking the UTC day of
// the current instant instead is wrong for a church east of about UTC+5: at its 7am the UTC day is still
// yesterday, so a daily job ran a day late (and a church west of UTC gets the next day in the evening).
function churchToday(now = new Date()) {
  return resolveToday(null, now);
}

module.exports = { resolveToday, churchToday };
