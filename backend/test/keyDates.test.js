// The pure key-date rule. No database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  upcomingKeyDates,
  isHandled,
  isSupportMilestone,
  KEY_DATE_LEAD_DAYS,
} = require("../src/utils/keyDates");

const day = (s) => new Date(`${s}T00:00:00Z`);
const TODAY = day("2026-11-24");
const partner = (over = {}) => ({
  id: "p1",
  adults: [],
  children: [],
  anniversary: null,
  supportingSince: null,
  ...over,
});

test("finds a birthday inside the window, soonest first, with the age they turn", () => {
  const p = partner({
    adults: [
      { id: "a1", firstName: "Dana", lastName: "Reed", birthday: day("1980-11-28") },
      { id: "a2", firstName: "Sam", lastName: "Reed", birthday: day("1982-11-25") },
    ],
  });
  const out = upcomingKeyDates([p], TODAY);
  assert.deepEqual(
    out.map((i) => [i.who, i.date, i.daysUntil, i.turning]),
    [
      ["Sam Reed", "2026-11-25", 1, 44],
      ["Dana Reed", "2026-11-28", 4, 46],
    ]
  );
  assert.equal(out[0].kind, "birthday");
  assert.equal(out[0].subjectId, "a2");
});

test("includes today, excludes beyond the lead days, and uses the shared lead default", () => {
  assert.equal(KEY_DATE_LEAD_DAYS, 7);
  const p = partner({
    adults: [
      { id: "a1", firstName: "Today", birthday: day("1990-11-24") },
      { id: "a2", firstName: "Edge", birthday: day("1990-12-01") },
      { id: "a3", firstName: "Far", birthday: day("1990-12-02") },
    ],
  });
  assert.deepEqual(
    upcomingKeyDates([p], TODAY).map((i) => i.who),
    ["Today", "Edge"]
  );
  assert.deepEqual(
    upcomingKeyDates([p], TODAY, 8).map((i) => i.who),
    ["Today", "Edge", "Far"]
  );
});

test("children's birthdays and the wedding anniversary count; a missing date is ignored", () => {
  const p = partner({
    children: [{ id: "c1", firstName: "Kid", lastName: "Reed", birthday: day("2015-11-26") }],
    anniversary: day("2008-11-25"),
    adults: [{ id: "a1", firstName: "NoDate", birthday: null }],
  });
  const out = upcomingKeyDates([p], TODAY);
  assert.deepEqual(
    out.map((i) => [i.kind, i.occasion, i.turning]),
    [
      ["anniversary", "Wedding anniversary", 18],
      ["childBirthday", "Birthday", 11],
    ]
  );
  assert.equal(out[0].subjectId, "", "a partner-level date has no subject");
});

test("supported-since is a milestone, not a yearly event", () => {
  assert.deepEqual([1, 2, 4, 5, 6, 10, 15].map(isSupportMilestone), [
    true,
    false,
    false,
    true,
    false,
    true,
    true,
  ]);
  assert.equal(isSupportMilestone(0), false);
  const mk = (since) => partner({ supportingSince: day(since) });
  // 5 years on the 25th: due. 3 years: not.
  assert.equal(upcomingKeyDates([mk("2021-11-25")], TODAY).length, 1);
  assert.equal(upcomingKeyDates([mk("2023-11-25")], TODAY).length, 0);
});

test("a Feb 29 birthday lands on Feb 28 in a non-leap year", () => {
  const p = partner({ adults: [{ id: "a1", firstName: "Leap", birthday: day("2000-02-29") }] });
  const out = upcomingKeyDates([p], day("2027-02-25"));
  assert.equal(out[0].date, "2027-02-28");
});

test("a key-date contact log entry within the lead days clears it; other topics and far dates don't", () => {
  const item = { date: "2026-11-28" };
  const log = (topics, contactDate) => ({ topics, contactDate: day(contactDate) });
  assert.equal(isHandled(item, [log(["keydate"], "2026-11-26")]), true);
  assert.equal(isHandled(item, [log(["keydate"], "2026-12-03")]), true, "sent just after still counts");
  assert.equal(isHandled(item, [log(["checkin"], "2026-11-26")]), false);
  assert.equal(
    isHandled(item, [log(["keydate"], "2026-10-01")]),
    false,
    "last year's card isn't this year's"
  );
  assert.equal(isHandled(item, []), false);
});

test("a commissioning anniversary is a key date, with the years", () => {
  const p = partner({ commissionedAt: day("2016-11-25") });
  const out = upcomingKeyDates([p], TODAY);
  assert.deepEqual(
    out.map((i) => [i.kind, i.occasion, i.turning]),
    [["commissioned", "Commissioned", 10]]
  );
});
