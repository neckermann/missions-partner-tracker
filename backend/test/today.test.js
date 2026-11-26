const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resolveToday } = require("../src/utils/today");

// The fallback path must not be a plain `new Date()` read later with UTC getters: that is
// correct only in UTC, where "right now" and "right now at UTC midnight" land on the same
// calendar day.
//
// This test sets process.env.TZ itself rather than trusting the runner's value, because
// resolveToday's fallback uses local getters: unlike test/birthdays.test.js's UTC-getter
// assertions, it would silently pass under TZ=UTC and only exercise the bug under a zone like
// CI's TZ=America/Los_Angeles.
describe("resolveToday", () => {
  let originalTz;

  before(() => {
    originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
  });

  after(() => {
    process.env.TZ = originalTz;
  });

  test("an explicit today is parsed as-is, not reinterpreted", () => {
    const resolved = resolveToday("2026-03-01");
    assert.equal(resolved.toISOString(), "2026-03-01T00:00:00.000Z");
  });

  test("the fallback reads the injected clock's local calendar day, not its UTC one", () => {
    // 11pm on 14 March in America/Los_Angeles (UTC-7 after DST begins) is already 15 March in UTC;
    // a UTC-getter read of this instant would misreport the day.
    const lateNightPacific = new Date("2026-03-15T06:00:00.000Z");
    const resolved = resolveToday(undefined, lateNightPacific);
    assert.equal(
      resolved.toISOString(),
      "2026-03-14T00:00:00.000Z",
      "should resolve to the 14th (the injected clock's local day), not the 15th (its UTC day)"
    );
  });

  test("the fallback result is shaped as UTC midnight, matching the explicit-today path", () => {
    const resolved = resolveToday(undefined, new Date("2026-06-01T18:30:00.000Z"));
    assert.equal(resolved.getUTCHours(), 0);
    assert.equal(resolved.getUTCMinutes(), 0);
    assert.equal(resolved.getUTCSeconds(), 0);
  });

  test("defaults the injected clock to the real current time when omitted", () => {
    // Not a raw instant-distance bound: UTC-midnight-of-the-local-day can legitimately be up to
    // 24h plus the zone's UTC offset away from the current instant whenever the zone is behind UTC
    // (e.g. 23:59 Pacific is ~32h past UTC-midnight of the Pacific date), so a flat 24h bound
    // fails deterministically late in the Pacific day. Test the real invariant: resolved equals
    // UTC-midnight of the current moment's own local calendar day, read the way resolveToday reads
    // it (process.env.TZ is already set for this block).
    const now = new Date();
    const resolved = resolveToday(undefined);
    const expected = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    assert.equal(resolved.toISOString(), expected.toISOString());
  });
});
