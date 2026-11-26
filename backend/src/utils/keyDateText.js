// The plain wording of a key date, shared by the key-date email and the chat post. No dependencies, so any module can use it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function when(item) {
  const d = new Date(`${item.date}T00:00:00Z`);
  const date = `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (item.daysUntil === 0) return `Today · ${date}`;
  if (item.daysUntil === 1) return `Tomorrow · ${date}`;
  return `In ${item.daysUntil} days · ${date}`;
}

// What the date is, e.g. "Dana Reed's birthday (turning 31)". A restricted family's own names stay out of anything
// that leaves the app.
function keyDateWhat(item, restricted) {
  if (item.kind === "anniversary") {
    return `wedding anniversary${item.turning ? ` (${item.turning} years)` : ""}`;
  }
  if (item.kind === "commissioned") {
    return `${item.turning} ${item.turning === 1 ? "year" : "years"} since they were commissioned`;
  }
  if (item.kind === "supportingSince") {
    return `${item.turning} ${item.turning === 1 ? "year" : "years"} of our support`;
  }
  const who = restricted || !item.who ? "a birthday" : `${item.who}'s birthday`;
  return item.turning ? `${who} (turning ${item.turning})` : who;
}

module.exports = { keyDateWhat, when };
