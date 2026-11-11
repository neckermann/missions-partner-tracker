// Resolves the "today" every report's run() receives as its third argument,
// as a Date at UTC midnight representing a calendar day -- see
// reports/index.js's header comment for the full reasoning on that shape
// and why every consumer reads it with UTC getters, not local ones.
//
// Pure and free of Express on purpose: the only interesting logic here is
// "which calendar day does this represent," worth testing directly against
// an injected `now` rather than through a live HTTP request waiting for a
// specific real-world moment to arrive.
function resolveToday(queryToday, now = new Date()) {
  if (queryToday) return new Date(queryToday);
  // No browser-supplied day: fall back to today in the church's configured
  // timezone (process.env.TZ, set from ChurchSettings.timezone at startup --
  // see server.js). `now`'s local getters already read through that zone;
  // re-encoding as UTC midnight matches the shape the browser-supplied path
  // produces, so every downstream consumer can use the same UTC getters
  // regardless of which path actually produced `today`.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

module.exports = { resolveToday };
