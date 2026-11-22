const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/reporting/definitions");

const day = (s) => new Date(`${s}T00:00:00.000Z`);
const entry = (amount, eff, created) => ({ amount, effectiveDate: day(eff), createdAt: day(created || eff) });

test("daysBetween counts calendar days regardless of time of day", () => {
  assert.equal(d.daysBetween(day("2026-03-10"), day("2026-03-01")), 9);
  assert.equal(d.daysBetween(new Date("2026-03-10T23:59:00Z"), new Date("2026-03-01T00:01:00Z")), 9);
  assert.equal(d.daysBetween(day("2026-03-01"), day("2026-03-10")), -9);
});

test("monthlySupportAsOf uses the latest entry on or before the day, ignores future entries", () => {
  const ledger = [entry(100, "2025-01-01"), entry(150, "2026-01-01"), entry(300, "2027-01-01")];
  assert.equal(d.monthlySupportAsOf(ledger, day("2025-06-01")), 100);
  assert.equal(d.monthlySupportAsOf(ledger, day("2026-01-01")), 150);
  assert.equal(d.monthlySupportAsOf(ledger, day("2026-12-31")), 150);
  assert.equal(d.monthlySupportAsOf(ledger, day("2024-12-31")), 0);
  assert.equal(d.monthlySupportAsOf([], day("2026-01-01")), 0);
});

test("a $0 entry means support ended; same-day ties go to the later-created entry", () => {
  assert.equal(d.monthlySupportAsOf([entry(100, "2025-01-01"), entry(0, "2025-06-01")], day("2025-07-01")), 0);
  const tie = [entry(100, "2025-01-01", "2025-01-01"), entry(200, "2025-01-01", "2025-01-02")];
  assert.equal(d.monthlySupportAsOf(tie, day("2025-02-01")), 200);
});

test("committedBetween counts each month at the amount in force on its first day", () => {
  const ledger = [entry(100, "2026-01-01"), entry(200, "2026-03-15")];
  // Jan 100 + Feb 100 + Mar 100 (change is mid-month, so from April) + Apr 200
  assert.equal(d.committedBetween(ledger, day("2026-01-01"), day("2026-04-30")), 500);
  assert.equal(d.committedBetween([], day("2026-01-01"), day("2026-12-31")), 0);
  // spans a year boundary
  assert.equal(d.committedBetween([entry(10, "2025-01-01")], day("2025-11-01"), day("2026-02-28")), 40);
});

test("supportChange classifies new, increase, decrease, ended, unchanged", () => {
  const from = day("2026-01-01");
  const to = day("2026-12-31");
  assert.equal(d.supportChange([entry(50, "2026-05-01")], from, to).type, "new");
  assert.equal(d.supportChange([entry(100, "2025-01-01"), entry(150, "2026-05-01")], from, to).type, "increase");
  assert.equal(d.supportChange([entry(100, "2025-01-01"), entry(50, "2026-05-01")], from, to).type, "decrease");
  assert.equal(d.supportChange([entry(100, "2025-01-01"), entry(0, "2026-05-01")], from, to).type, "ended");
  const same = d.supportChange([entry(100, "2025-01-01")], from, to);
  assert.equal(same.type, "unchanged");
  assert.equal(same.delta, 0);
  assert.equal(d.supportChange([entry(100, "2025-01-01"), entry(150, "2026-05-01")], from, to).delta, 50);
});

test("prayerState: open ages bucket, answered gets days-to-answer, untracked is neither", () => {
  const today = day("2026-06-01");
  const open = d.prayerState({ status: "ongoing", dateReceived: day("2026-05-20") }, today);
  assert.deepEqual([open.state, open.ageDays, open.bucket], ["open", 12, "0-30 days"]);
  assert.equal(d.prayerState({ status: "ongoing", dateReceived: day("2026-04-01") }, today).bucket, "31-90 days");
  assert.equal(d.prayerState({ status: "ongoing", dateReceived: day("2025-01-01") }, today).bucket, "91+ days");
  const ans = d.prayerState(
    { status: "answered", dateReceived: day("2026-01-01"), dateAnswered: day("2026-01-31") },
    today
  );
  assert.deepEqual([ans.state, ans.daysToAnswer], ["answered", 30]);
  assert.equal(d.prayerState({ status: "untracked", dateReceived: day("2026-01-01") }, today).state, "untracked");
});

test("needDecision and turnaround", () => {
  assert.equal(d.needDecision({ requestedAmount: 500, approvedAmount: null }), "pending");
  assert.equal(d.needDecision({ requestedAmount: 500, approvedAmount: 0 }), "declined");
  assert.equal(d.needDecision({ requestedAmount: 500, approvedAmount: 200 }), "partial");
  assert.equal(d.needDecision({ requestedAmount: 500, approvedAmount: 500 }), "approved");
  assert.equal(
    d.needTurnaroundDays({ approvedAmount: 500, requestDate: day("2026-01-01"), approvedDate: day("2026-01-11") }),
    10
  );
  assert.equal(d.needTurnaroundDays({ approvedAmount: null, requestDate: day("2026-01-01") }), null);
});

test("fundraising: percent and remaining, no goal means no percent", () => {
  assert.deepEqual(d.fundraising(1000, [{ amount: 250 }, { amount: 250 }]), {
    raised: 500,
    goal: 1000,
    percent: 50,
    remaining: 500,
  });
  assert.equal(d.fundraising(1000, [{ amount: 1500 }]).remaining, 0);
  assert.deepEqual(d.fundraising(null, [{ amount: 10 }]), { raised: 10, goal: null, percent: null, remaining: null });
});

test("isMinor and minors-only requirement applicability", () => {
  assert.equal(d.isMinor(day("2010-07-01"), day("2026-06-30")), true); // 15
  assert.equal(d.isMinor(day("2008-06-30"), day("2026-06-30")), false); // turns 18 that day
  assert.equal(d.isMinor(null, day("2026-06-30")), false);
  const req = { minorsOnly: true };
  assert.equal(d.requirementApplies(req, { dateOfBirth: day("2015-01-01") }, day("2026-06-30")), true);
  assert.equal(d.requirementApplies(req, { dateOfBirth: day("1990-01-01") }, day("2026-06-30")), false);
  assert.equal(d.requirementApplies({ minorsOnly: false }, { dateOfBirth: day("1990-01-01") }, day("2026-06-30")), true);
});

test("requirementDone: tasks need a completed status, documents need a file", () => {
  const task = { id: "r1", kind: "task" };
  const doc = { id: "r2", kind: "document" };
  const statuses = [{ requirementId: "r1", participantId: "p1", completedAt: new Date() }];
  const docs = [{ requirementId: "r2", participantId: "p1" }];
  assert.equal(d.requirementDone(task, "p1", statuses, docs), true);
  assert.equal(d.requirementDone(task, "p2", statuses, docs), false);
  assert.equal(d.requirementDone(doc, "p1", statuses, docs), true);
  assert.equal(d.requirementDone(doc, "p2", statuses, docs), false);
  assert.equal(
    d.requirementDone(task, "p1", [{ requirementId: "r1", participantId: "p1", completedAt: null }], []),
    false
  );
});

test("completeness lists what's missing", () => {
  const full = {
    overviewShort: "x",
    contactEmail: "a@b.c",
    preferredContactMethod: "Email",
    addresses: [{}],
    emergencyContactName: "N",
    emergencyContactPhone: "1",
    languages: [{}],
    photos: [{}],
    supportingSince: day("2020-01-01"),
  };
  assert.deepEqual(d.completeness(full), { missing: [], filled: 8, total: 8, percent: 100 });
  const sparse = d.completeness({ addresses: [], languages: [], photos: [] });
  assert.equal(sparse.filled, 0);
  assert.equal(sparse.missing.length, 8);
  assert.equal(sparse.percent, 0);
});
