// When a scheduled send is due. Pure (no I/O, no Date.now()), in the host's local time, which is the church's time
// (process.env.TZ, utils/timezone.js).
//
// A send used to fire only when the clock read exactly the configured day and hour. That missed two cases: the
// worker being down for that one hour (a monthly digest was skipped until next month, with no notice), and the
// clock-change day when the configured hour does not exist (2am on the spring day). Instead, each schedule has a
// most recent "slot" (the last time the configured day and hour came round, which a local-time Date resolves to a
// real moment even on a clock-change day), and a send is due once that slot has passed without a send.
//
//   - Sent before: due when the last send was before the slot, and long enough ago for this cadence
//     (minGapMs, which also stops a second send in the same cycle).
//   - Never sent: due only shortly after the slot (FIRST_SEND_GRACE_MS), so configuring a schedule on the 20th for
//     "the 5th" does not send straight away; it waits for the next 5th.
const FIRST_SEND_GRACE_MS = 6 * 60 * 60 * 1000;

const atHour = (year, month, date, hour) => new Date(year, month, date, hour, 0, 0, 0);

// The most recent time (at or before `now`) it was `hour` o'clock.
function mostRecentDailySlot(now, hour) {
  const today = atHour(now.getFullYear(), now.getMonth(), now.getDate(), hour);
  return today <= now ? today : atHour(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour);
}

// The most recent time (at or before `now`) it was `hour` o'clock on `weekday` (0 = Sunday).
function mostRecentWeeklySlot(now, weekday, hour) {
  for (let back = 0; back <= 7; back += 1) {
    const day = atHour(now.getFullYear(), now.getMonth(), now.getDate() - back, hour);
    if (day.getDay() === weekday && day <= now) return day;
  }
  return null;
}

// The most recent time (at or before `now`) it was `hour` o'clock on day `dayOfMonth`. A day past the end of a
// short month (the 31st in February) means that month's last day.
function mostRecentMonthlySlot(now, dayOfMonth, hour) {
  for (let monthsBack = 0; monthsBack <= 1; monthsBack += 1) {
    const month = now.getMonth() - monthsBack;
    const daysInMonth = new Date(now.getFullYear(), month + 1, 0).getDate();
    const slot = atHour(now.getFullYear(), month, Math.min(dayOfMonth, daysInMonth), hour);
    if (slot <= now) return slot;
  }
  return null;
}

function isSlotDue(slot, lastSentAt, minGapMs, now) {
  if (!slot || now < slot) return false;
  if (!lastSentAt) return now - slot < FIRST_SEND_GRACE_MS;
  return lastSentAt < slot && now - lastSentAt >= minGapMs;
}

module.exports = {
  FIRST_SEND_GRACE_MS,
  mostRecentDailySlot,
  mostRecentWeeklySlot,
  mostRecentMonthlySlot,
  isSlotDue,
};
