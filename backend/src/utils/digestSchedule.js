// When a person's next email digest is due, worked out from the church's dispatch schedule and the last
// time that tier went out. Approximate on purpose (it ignores the hour): it only answers "will a digest reach
// this person before a given date?", which the key-date job uses to decide whether a short email of its own is needed.

const DAY_MS = 24 * 60 * 60 * 1000;
// The same minimum gaps the scheduler uses to tell a real cycle from an extra tick (emailDispatchScheduler.js).
const GAP_DAYS = { biweekly: 13, monthly: 27, quarterly: 85 };
const LAST_SENT = {
  biweekly: "lastBiweeklyEmailDispatchSentAt",
  monthly: "lastMonthlyEmailDispatchSentAt",
  quarterly: "lastQuarterlyEmailDispatchSentAt",
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// The day the next digest of `cadence` goes out, or null when the person has no digest or the church hasn't set a schedule.
function nextDigestDay(cadence, settings, now = new Date()) {
  if (!GAP_DAYS[cadence] || !settings) return null;
  const weekly = cadence === "biweekly";
  const slot = weekly ? settings.emailDispatchDayOfWeek : settings.emailDispatchDayOfMonth;
  if (slot == null || settings.emailDispatchHour == null) return null;

  const last = settings[LAST_SENT[cadence]];
  const earliest = last ? new Date(new Date(last).getTime() + GAP_DAYS[cadence] * DAY_MS) : now;
  let day = startOfDay(earliest < now ? now : earliest);
  for (let i = 0; i < 400; i += 1) {
    if ((weekly ? day.getDay() : day.getDate()) === slot) return day;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return null;
}

// True when a digest will go out on or before `dateYmd` ("YYYY-MM-DD"), so a heads-up can wait for it.
function digestComesBefore(cadence, settings, dateYmd, now = new Date()) {
  const next = nextDigestDay(cadence, settings, now);
  if (!next) return false;
  const ymd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  return ymd <= dateYmd;
}

module.exports = { nextDigestDay, digestComesBefore };
