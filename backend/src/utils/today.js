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

module.exports = { resolveToday };
