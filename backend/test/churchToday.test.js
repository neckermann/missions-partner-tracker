// B7 of the November 2026 app review: "today" for the scheduled jobs is the church's own calendar day, not the
// UTC day of the current instant. East of about UTC+5 the two differ at the church's 7am, so the daily key-date
// and care-post jobs ran a day late (the same class of bug as #253 and #401).
const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { churchToday } = require("../src/utils/today");
const { applyChurchTimezone } = require("../src/utils/timezone");

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const day = (d) => d.toISOString().slice(0, 10);

describe("churchToday", () => {
  test("a church ahead of UTC is already on the next day when UTC is still on the previous one", () => {
    process.env.TZ = "Australia/Sydney"; // UTC+11 in November
    // 20:00 UTC on the 26th is 07:00 on the 27th in Sydney, the hour the daily key-date job runs.
    assert.equal(day(churchToday(new Date("2026-11-26T20:00:00Z"))), "2026-11-27");
  });

  test("a church behind UTC is still on the previous day when UTC has moved on", () => {
    process.env.TZ = "America/Los_Angeles"; // UTC-8 in November
    assert.equal(day(churchToday(new Date("2026-11-27T03:00:00Z"))), "2026-11-26");
  });

  test("in UTC it is the UTC day", () => {
    process.env.TZ = "UTC";
    assert.equal(day(churchToday(new Date("2026-11-26T23:59:00Z"))), "2026-11-26");
  });

  test("the result is midnight UTC of that calendar day (the shape the key-date code expects)", () => {
    process.env.TZ = "Asia/Tokyo";
    const d = churchToday(new Date("2026-06-15T18:30:00Z"));
    assert.equal(d.toISOString(), "2026-06-16T00:00:00.000Z");
  });
});

describe("applyChurchTimezone", () => {
  test("changes what every later 'today' says, with no restart", () => {
    const at = new Date("2026-11-26T20:00:00Z");
    applyChurchTimezone("UTC");
    assert.equal(day(churchToday(at)), "2026-11-26");
    applyChurchTimezone("Pacific/Auckland");
    assert.equal(day(churchToday(at)), "2026-11-27");
  });

  test("an empty or unknown zone falls back to UTC and never throws", () => {
    assert.equal(applyChurchTimezone(null), "UTC");
    assert.equal(applyChurchTimezone(""), "UTC");
    assert.equal(applyChurchTimezone("Not/AZone"), "UTC");
    assert.equal(process.env.TZ, "UTC");
  });
});
