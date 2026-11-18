const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resolveToday } = require("../src/utils/today");

// Issue #253: the fallback path used to be a plain `new Date()` read later
// with UTC getters -- correct by accident only in UTC, where "right now"
// and "right now at UTC midnight" land on the same calendar day.
//
// This test sets process.env.TZ itself rather than trusting the runner's
// ambient value, because resolveToday's fallback uses *local* getters --
// unlike test/birthdays.test.js's UTC-getter assertions, which hold in any
// zone by construction, this one would silently pass under TZ=UTC (where
// local and UTC calendar days always agree) and only actually exercise the
// bug under a zone like CI's own TZ=America/Los_Angeles. Setting it
// explicitly means this test catches the regression everywhere, not just
// when it happens to run in CI.
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
    // 11pm on 14 March in America/Los_Angeles (UTC-7 in March, after DST
    // begins) is already 15 March in UTC. A UTC-getter read of this exact
    // instant would misreport the day -- that's the bug this fix closes.
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
    // Not a raw instant-distance bound -- a prior version of this
    // assertion (`after - resolved.getTime() < 24h`) was itself buggy,
    // not flaky: UTC-midnight-of-the-local-day can legitimately be up to
    // 24h *plus* the zone's UTC offset away from the real current instant
    // whenever that zone is behind UTC (exactly what America/Los_Angeles,
    // set by this describe block's own before() hook, exercises) -- e.g.
    // a run at 23:59 Pacific (07:59 UTC) is ~32h past UTC-midnight-of-
    // today's-Pacific-date, correctly exceeding a flat 24h bound. That's
    // why this failed deterministically once a CI run's real-world clock
    // landed late enough in the Pacific day, not randomly. Test the real
    // invariant instead: resolved should equal UTC-midnight of the
    // current moment's own local calendar day, read the same way
    // resolveToday itself reads it (process.env.TZ is already set for
    // this whole block).
    const now = new Date();
    const resolved = resolveToday(undefined);
    const expected = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    assert.equal(resolved.toISOString(), expected.toISOString());
  });
});
