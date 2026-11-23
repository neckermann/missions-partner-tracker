// The shared definitions every report reads from. A number means one thing
// in this app: "current monthly support," "open prayer request age," and
// "trip readiness" are each defined exactly once, here, so two reports (or
// a report and a dashboard) can never disagree about them.
//
// Everything in this file is pure -- plain values in, plain values out, no
// database, no clock -- so each definition is unit-tested directly against
// fixtures (backend/test/reportingDefinitions.test.js).
//
// Dates: Prisma returns @db.Date columns as a Date at UTC midnight, and
// reports receive "today" the same way (utils/today.js), so every
// comparison below works on UTC calendar days.

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Whole calendar days from `earlier` to `later` (negative if reversed).
function daysBetween(later, earlier) {
  return Math.round((toUtcDay(later) - toUtcDay(earlier)) / DAY_MS);
}

function addDays(value, days) {
  return new Date(toUtcDay(value).getTime() + days * DAY_MS);
}

// ---------------------------------------------------------------------
// Support. A partner's support is a ledger of SupportEntry rows -- each a
// whole-dollar MONTHLY amount that takes effect on a date. This is what the
// church has committed to give, not a record of gifts actually sent.
// ---------------------------------------------------------------------

// The entry in force on `asOf`: the latest one effective on or before that
// day (a later createdAt wins a same-day tie). null if none had started.
function supportEntryAsOf(entries, asOf) {
  const cutoff = toUtcDay(asOf).getTime();
  let best = null;
  for (const e of entries || []) {
    const eff = toUtcDay(e.effectiveDate).getTime();
    if (eff > cutoff) continue;
    if (
      !best ||
      eff > toUtcDay(best.effectiveDate).getTime() ||
      (eff === toUtcDay(best.effectiveDate).getTime() &&
        new Date(e.createdAt || 0) > new Date(best.createdAt || 0))
    ) {
      best = e;
    }
  }
  return best;
}

// Current monthly support on `asOf`. A partner with no entry yet, or whose
// latest entry is $0 (the ledger's way of saying support ended), is 0.
function monthlySupportAsOf(entries, asOf) {
  return supportEntryAsOf(entries, asOf)?.amount ?? 0;
}

// What the ledger commits across the months from `from` to `to` inclusive.
// Each calendar month counts at the amount in force on its first day, so a
// mid-month change takes effect from the next month -- stated once here
// rather than argued per report.
function committedBetween(entries, from, to) {
  const start = toUtcDay(from);
  const end = toUtcDay(to);
  let total = 0;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  // A month counts if its first day falls on or after the range start;
  // the first partial month is represented by the range's own first day.
  for (;;) {
    const first = new Date(Date.UTC(y, m, 1));
    if (first > end) break;
    const probe = first < start ? start : first;
    total += monthlySupportAsOf(entries, probe);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return total;
}

// How a partner's monthly support moved between two days.
// type: new | increase | decrease | ended | unchanged
function supportChange(entries, from, to) {
  const before = monthlySupportAsOf(entries, addDays(from, -1));
  const after = monthlySupportAsOf(entries, to);
  let type = "unchanged";
  if (before === 0 && after > 0) type = "new";
  else if (before > 0 && after === 0) type = "ended";
  else if (after > before) type = "increase";
  else if (after < before) type = "decrease";
  return { before, after, delta: after - before, type };
}

// ---------------------------------------------------------------------
// Prayer requests.
// ---------------------------------------------------------------------

const PRAYER_AGE_BUCKETS = ["0-30 days", "31-90 days", "91+ days"];

function ageBucket(ageDays) {
  if (ageDays <= 30) return PRAYER_AGE_BUCKETS[0];
  if (ageDays <= 90) return PRAYER_AGE_BUCKETS[1];
  return PRAYER_AGE_BUCKETS[2];
}

// "Open" means still being prayed over: status ongoing. "Untracked" is the
// app's "don't track this one" state and counts as neither open nor answered.
function prayerState(request, asOf) {
  if (request.status === "answered") {
    return {
      state: "answered",
      daysToAnswer:
        request.dateAnswered && request.dateReceived
          ? daysBetween(request.dateAnswered, request.dateReceived)
          : null,
      ageDays: null,
      bucket: null,
    };
  }
  if (request.status === "ongoing") {
    const ageDays = daysBetween(asOf, request.dateReceived);
    return { state: "open", daysToAnswer: null, ageDays, bucket: ageBucket(ageDays) };
  }
  return { state: "untracked", daysToAnswer: null, ageDays: null, bucket: null };
}

// ---------------------------------------------------------------------
// One-time needs. approvedAmount null = still awaiting a decision, 0 =
// declined, less than requested = partially funded (same reading the admin
// UI uses).
// ---------------------------------------------------------------------

function needDecision(need) {
  if (need.approvedAmount == null) return "pending";
  if (need.approvedAmount === 0) return "declined";
  if (need.approvedAmount < need.requestedAmount) return "partial";
  return "approved";
}

// Days from the request to the decision, or null while pending / undated.
function needTurnaroundDays(need) {
  if (need.approvedAmount == null || !need.approvedDate || !need.requestDate) return null;
  return daysBetween(need.approvedDate, need.requestDate);
}

// ---------------------------------------------------------------------
// Trips.
// ---------------------------------------------------------------------

function sumAmounts(rows) {
  return (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
}

// Raised vs goal. percent is null when no goal is set.
function fundraising(goal, contributions) {
  const raised = sumAmounts(contributions);
  const hasGoal = typeof goal === "number" && goal > 0;
  return {
    raised,
    goal: hasGoal ? goal : null,
    percent: hasGoal ? Math.round((raised / goal) * 100) : null,
    remaining: hasGoal ? Math.max(goal - raised, 0) : null,
  };
}

// True when the participant is under 18 on the trip's start (or `asOf` if
// the trip is undated) -- the same "minor" the minors-only requirements use.
function isMinor(dateOfBirth, onDate) {
  if (!dateOfBirth || !onDate) return false;
  const dob = new Date(dateOfBirth);
  const on = new Date(onDate);
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dob.getUTCMonth() ||
    (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 18;
}

// A requirement applies to a participant unless it's minors-only and they
// aren't a minor. A requirement is done when the participant has a
// completed status (tasks) or a document on file (document/esignature).
function requirementApplies(requirement, participant, tripDate) {
  return !requirement.minorsOnly || isMinor(participant.dateOfBirth, tripDate);
}

function requirementDone(requirement, participantId, statuses, documents) {
  if (requirement.kind === "task") {
    return (statuses || []).some(
      (s) => s.requirementId === requirement.id && s.participantId === participantId && s.completedAt
    );
  }
  return (documents || []).some(
    (d) => d.requirementId === requirement.id && d.participantId === participantId
  );
}

// ---------------------------------------------------------------------
// Data completeness. The fields a church would want on every partner.
// ---------------------------------------------------------------------

const COMPLETENESS_CHECKS = [
  { key: "overview", label: "Overview", test: (p) => !!(p.overviewShort || p.overview) },
  { key: "contact", label: "Contact (email or phone)", test: (p) => !!(p.contactEmail || p.contactPhone) },
  {
    key: "preferredContactMethod",
    label: "Preferred contact method",
    test: (p) => !!p.preferredContactMethod,
  },
  { key: "address", label: "Address", test: (p) => (p.addresses || []).length > 0 },
  {
    key: "emergencyContact",
    label: "Emergency contact",
    test: (p) => !!(p.emergencyContactName && (p.emergencyContactPhone || p.emergencyContactEmail)),
  },
  { key: "language", label: "Language", test: (p) => (p.languages || []).length > 0 },
  { key: "photo", label: "Photo", test: (p) => (p.photos || []).length > 0 },
  { key: "supportingSince", label: "Supporting since", test: (p) => !!p.supportingSince },
];

// { missing: [labels], filled, total, percent }
function completeness(partner) {
  const missing = COMPLETENESS_CHECKS.filter((c) => !c.test(partner)).map((c) => c.label);
  const total = COMPLETENESS_CHECKS.length;
  const filled = total - missing.length;
  return { missing, filled, total, percent: Math.round((filled / total) * 100) };
}

// ---------------------------------------------------------------------
// Annual dates (birthdays, anniversaries).
// ---------------------------------------------------------------------

// The next time a month/day recurs on or after `from`. Feb 29 falls on
// Feb 28 in a non-leap year. `years` is how many years the date will mark
// (null when the original year is unknown/placeholder).
function nextAnnual(date, from) {
  const d = toUtcDay(date);
  const f = toUtcDay(from);
  const build = (year) => {
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  };
  let next = build(f.getUTCFullYear());
  if (next < f) next = build(f.getUTCFullYear() + 1);
  return { next, daysUntil: daysBetween(next, f), years: next.getUTCFullYear() - d.getUTCFullYear() };
}

// Hours between two timestamps, one decimal, or null if either is missing.
function hoursBetween(later, earlier) {
  if (!later || !earlier) return null;
  return Math.round(((new Date(later) - new Date(earlier)) / 3600000) * 10) / 10;
}

function average(values) {
  const nums = values.filter((v) => typeof v === "number");
  return nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10 : null;
}

module.exports = {
  nextAnnual,
  hoursBetween,
  average,
  DAY_MS,
  toUtcDay,
  daysBetween,
  addDays,
  supportEntryAsOf,
  monthlySupportAsOf,
  committedBetween,
  supportChange,
  PRAYER_AGE_BUCKETS,
  ageBucket,
  prayerState,
  needDecision,
  needTurnaroundDays,
  sumAmounts,
  fundraising,
  isMinor,
  requirementApplies,
  requirementDone,
  COMPLETENESS_CHECKS,
  completeness,
};
