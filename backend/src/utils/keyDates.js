// Which birthdays, anniversaries and supported-since milestones are coming up.
// Pure (no database), so the bell, the daily email and anything else read one
// definition. Date math is reporting/definitions.js's nextAnnual (shared with the
// "Families & key dates" report), so Feb 29 and the turning-age rule can't drift.

const { nextAnnual, daysBetween } = require("../reporting/definitions");

// How far ahead a key date becomes "due": a fixed default (a card needs about a week), so bell and email agree.
const KEY_DATE_LEAD_DAYS = 7;

// "Partnering since" is a milestone: the first year, then every fifth (year-only
// start dates are stored as Jan 1, so yearly would always say "Jan 1").
const isSupportMilestone = (years) => years >= 1 && (years === 1 || years % 5 === 0);

const ymd = (d) => d.toISOString().slice(0, 10);
const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ");

// partners: [{ id, displayName, adults:[{id,firstName,lastName,birthday}],
//   children:[...], anniversary, supportingSince, commissionedAt }]. Everything within
// `leadDays` of `today` (inclusive of today), soonest first.
function upcomingKeyDates(partners, today, leadDays = KEY_DATE_LEAD_DAYS) {
  const out = [];
  const add = (
    partner,
    date,
    { kind, subjectId = "", who = "", occasion, withYears = true, keep = () => true }
  ) => {
    if (!date) return;
    const n = nextAnnual(date, today);
    if (n.daysUntil > leadDays) return;
    if (!keep(n.years)) return;
    out.push({
      partnerId: partner.id,
      kind,
      subjectId,
      who,
      occasion,
      date: ymd(n.next),
      daysUntil: n.daysUntil,
      turning: withYears ? n.years : null,
    });
  };
  for (const p of partners) {
    (p.adults || []).forEach((a) =>
      add(p, a.birthday, { kind: "birthday", subjectId: a.id, who: fullName(a), occasion: "Birthday" })
    );
    (p.children || []).forEach((c) =>
      add(p, c.birthday, { kind: "childBirthday", subjectId: c.id, who: fullName(c), occasion: "Birthday" })
    );
    add(p, p.anniversary, { kind: "anniversary", occasion: "Wedding anniversary" });
    add(p, p.commissionedAt, { kind: "commissioned", occasion: "Commissioned" });
    add(p, p.supportingSince, {
      kind: "supportingSince",
      occasion: "Partnering since",
      keep: isSupportMilestone,
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.partnerId.localeCompare(b.partnerId));
}

// An occurrence is handled once someone logged a contact for the partner with the
// "key date" topic within `leadDays` either side of it. Per partner, not per
// person: one card goes to the family.
function isHandled(item, logs, leadDays = KEY_DATE_LEAD_DAYS) {
  return logs.some(
    (l) =>
      l.topics?.includes("keydate") &&
      Math.abs(daysBetween(l.contactDate, new Date(`${item.date}T00:00:00Z`))) <= leadDays
  );
}

module.exports = { KEY_DATE_LEAD_DAYS, upcomingKeyDates, isHandled, isSupportMilestone };
