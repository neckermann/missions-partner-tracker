const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { toMonthDay, ageTurning, birthdaysInMonth } = require("../src/utils/birthdays");

// These pin the timezone trap this module exists to avoid. `birthday` is
// @db.Date, so Prisma returns UTC midnight; reading it with local getters
// gives the previous day for anyone west of UTC. That exact mistake shipped
// once already across sixteen files (fixed in 32aae84).

describe("toMonthDay", () => {
  test("returns the stored calendar date, whatever timezone the runner is in", () => {
    // UTC midnight on the 5th is 5pm on the 4th in California. A local
    // getDate() here returns 4. The assertion below must hold on a machine
    // in any zone, which is what makes this a real regression test rather
    // than one that only passes in CI's UTC.
    const stored = new Date("2017-11-05T00:00:00.000Z");
    assert.equal(stored.getUTCDate(), 5, "sanity: the stored value is the 5th in UTC");

    assert.deepEqual(toMonthDay(stored), { month: 11, day: 5, year: 2017 });
  });

  test("months are 1-12, not zero-based", () => {
    // Easy to get wrong in a way that only shows up as every birthday
    // landing one month early.
    assert.equal(toMonthDay(new Date("2000-01-15T00:00:00.000Z")).month, 1);
    assert.equal(toMonthDay(new Date("2000-12-15T00:00:00.000Z")).month, 12);
  });

  test("29 February survives as itself", () => {
    // Grouping by calendar month is what makes this a non-event: there is
    // no "what does 29 Feb mean this year" question to answer, because
    // nothing is being projected onto a rolling window.
    assert.deepEqual(toMonthDay(new Date("2016-02-29T00:00:00.000Z")), {
      month: 2,
      day: 29,
      year: 2016,
    });
  });

  test("accepts an ISO string as well as a Date", () => {
    assert.deepEqual(toMonthDay("1979-05-04T00:00:00.000Z"), { month: 5, day: 4, year: 1979 });
  });

  test("returns null for missing or malformed values instead of Invalid Date", () => {
    assert.equal(toMonthDay(null), null);
    assert.equal(toMonthDay(undefined), null);
    assert.equal(toMonthDay(""), null);
    assert.equal(toMonthDay("not-a-date"), null);
  });
});

describe("ageTurning", () => {
  test("counts the birthday in the given year", () => {
    assert.equal(ageTurning({ year: 2017 }, 2026), 9);
  });

  test("refuses implausible results rather than printing them", () => {
    // A placeholder birth year is a real possibility: the date input
    // requires a full date, so a church that didn't know one had to type
    // something. Better blank than "turns 1,026".
    assert.equal(ageTurning({ year: 2030 }, 2026), null);
    assert.equal(ageTurning({ year: 1000 }, 2026), null);
    assert.equal(ageTurning(null, 2026), null);
  });
});

describe("birthdaysInMonth", () => {
  const partners = [
    {
      id: "p1",
      displayName: "Frank and Lori Wexford",
      fieldDisplayName: "Catalonia",
      archived: false,
      adults: [
        { id: "a1", name: "Frank Wexford", birthday: new Date("1980-11-20T00:00:00.000Z") },
        { id: "a2", name: "Lori Wexford", birthday: new Date("1982-03-02T00:00:00.000Z") },
      ],
      children: [{ id: "c1", name: "Eli Wexford", birthday: new Date("2017-11-05T00:00:00.000Z") }],
    },
    {
      id: "p2",
      displayName: "Grace Tillman",
      fieldDisplayName: "Kathmandu Valley",
      archived: true,
      adults: [{ id: "a3", name: "Grace Tillman", birthday: new Date("1990-11-02T00:00:00.000Z") }],
      children: [],
    },
    {
      id: "p3",
      displayName: "No Birthdays Here",
      fieldDisplayName: null,
      archived: false,
      adults: [{ id: "a4", name: "Unknown Birthday", birthday: null }],
      children: [],
    },
  ];

  test("returns only the selected month, sorted by day", () => {
    const rows = birthdaysInMonth(partners, 11, { inYear: 2026 });
    assert.deepEqual(
      rows.map((r) => [r.day, r.name]),
      [
        [2, "Grace Tillman"],
        [5, "Eli Wexford"],
        [20, "Frank Wexford"],
      ]
    );
  });

  test("interleaves adults and children rather than sectioning them", () => {
    // The question is "whose birthday is coming up"; splitting a household
    // apart makes that harder to scan.
    const rows = birthdaysInMonth(partners, 11, { inYear: 2026 });
    assert.deepEqual(
      rows.map((r) => r.personType),
      ["adult", "child", "adult"]
    );
  });

  test("gives children the age they are turning, and adults none", () => {
    const rows = birthdaysInMonth(partners, 11, { inYear: 2026 });
    const eli = rows.find((r) => r.name === "Eli Wexford");
    const frank = rows.find((r) => r.name === "Frank Wexford");
    assert.equal(eli.turning, 9);
    assert.equal(frank.turning, null, "a wrong age for an adult is worse than no age");
  });

  test("carries partner context and the archived flag through", () => {
    const rows = birthdaysInMonth(partners, 11, { inYear: 2026 });
    const grace = rows.find((r) => r.name === "Grace Tillman");
    assert.equal(grace.partnerName, "Grace Tillman");
    assert.equal(grace.field, "Kathmandu Valley");
    assert.equal(grace.archived, true, "filtering archived rows is the caller's decision");
  });

  test("drops people with no birthday instead of inventing one", () => {
    const everyMonth = Array.from({ length: 12 }, (_, i) => birthdaysInMonth(partners, i + 1)).flat();
    assert.equal(
      everyMonth.some((r) => r.name === "Unknown Birthday"),
      false
    );
  });

  test("a month with nobody in it is empty, not an error", () => {
    assert.deepEqual(birthdaysInMonth(partners, 7, { inYear: 2026 }), []);
  });

  test("tolerates partners with no adults or children arrays at all", () => {
    assert.deepEqual(birthdaysInMonth([{ id: "x", displayName: "Bare" }], 1), []);
    assert.deepEqual(birthdaysInMonth(null, 1), []);
  });
});
