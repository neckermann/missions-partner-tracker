// Birthday helpers for the Upcoming Birthdays report.
//
// Pure and free of Prisma on purpose: the interesting logic here is calendar
// arithmetic, which is worth testing without standing up a database, and a
// scheduled digest (a weekly chat post, say) should be able to reuse it
// without going through an HTTP route.
//
// THE TRAP, stated once so nobody has to rediscover it:
//
// `birthday` is `@db.Date`, so Prisma hands it back as a JavaScript Date at
// *UTC midnight*. Read it with the local getters -- getMonth(), getDate() --
// and anyone west of UTC gets the previous day, because UTC midnight on the
// 5th is 5pm on the 4th in California. That is precisely the bug that made
// every date field in this app pre-fill tomorrow (fixed in 32aae84, pinned
// by frontend/src/utils/format.test.js). So: UTC getters only, and the unit
// tests assert it holds whatever timezone the runner is in.

// { month: 1-12, day: 1-31, year } for a stored date-only value, or null if
// there isn't a usable one. Returns a plain object rather than a Date so
// nothing downstream can reintroduce a timezone.
function toMonthDay(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    year: date.getUTCFullYear(),
  };
}

// The age someone reaches on their birthday in `inYear`.
//
// Only meaningful if the stored year is real. A church that didn't know a
// birth year had to type something -- the date input requires a full date --
// so this can be a placeholder. Callers decide whether to show it; the
// report shows it for children, where it's the useful part, and not for
// adults, where a wrong number is worse than no number.
function ageTurning(birth, inYear) {
  if (!birth || !Number.isFinite(birth.year)) return null;
  const age = inYear - birth.year;
  return age >= 0 && age < 130 ? age : null;
}

// Flattens partners into one row per person who has a birthday, sorted the
// way the report reads: by day of the month, then name.
//
// Adults and children are interleaved rather than sectioned -- the question
// the report answers is "whose birthday is coming up", and splitting the
// household apart makes that harder to scan, not easier.
//
// Takes partners with `adults` and `children` already included. `month` is
// 1-12 and comes from the caller (the browser's local month, since no church
// timezone is stored anywhere); filtering here rather than in SQL keeps the
// month/day extraction in one place and the dataset is a few hundred rows.
function birthdaysInMonth(partners, month, { inYear = new Date().getFullYear() } = {}) {
  const rows = [];

  for (const partner of partners || []) {
    const people = [
      ...(partner.adults || []).map((p) => ({ person: p, personType: "adult" })),
      ...(partner.children || []).map((p) => ({ person: p, personType: "child" })),
    ];

    for (const { person, personType } of people) {
      const birth = toMonthDay(person.birthday);
      if (!birth || birth.month !== month) continue;

      rows.push({
        id: person.id,
        name: person.name,
        personType,
        day: birth.day,
        month: birth.month,
        // Children only -- see ageTurning.
        turning: personType === "child" ? ageTurning(birth, inYear) : null,
        partnerId: partner.id,
        partnerName: partner.displayName,
        field: partner.fieldDisplayName || null,
        archived: Boolean(partner.archived),
      });
    }
  }

  return rows.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}

module.exports = { toMonthDay, ageTurning, birthdaysInMonth };
