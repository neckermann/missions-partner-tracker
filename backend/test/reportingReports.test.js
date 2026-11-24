const test = require("node:test");
const assert = require("node:assert");
const { listReports, getReport } = require("../src/reporting/registry");
const { applyMasking } = require("../src/reporting/masking");

const all = { role: "admin", isEnabled: () => true };
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const today = day("2026-11-22");
const run = (id, q, data) => {
  const r = getReport(id, all);
  return r.compute(data, r.params.parse(q), { today });
};

test("catalog hides admin-only and feature-gated reports", () => {
  const viewer = listReports({ role: "viewer", isEnabled: () => true });
  assert.ok(!viewer.reports.some((r) => r.id === "users-access"));
  const noTrips = listReports({ role: "admin", isEnabled: (k) => k !== "trips" });
  assert.ok(!noTrips.reports.some((r) => r.group === "trips"));
});

test("support summary uses the entry in force on the as-of day", () => {
  const p = (name, entries) => ({
    displayName: name,
    kind: "missionary",
    addresses: [],
    supportEntries: entries,
  });
  const e = (amount, d) => ({ amount, effectiveDate: day(d), createdAt: day(d) });
  const out = run("support-summary", {}, [
    p("A", [e(100, "2026-01-01"), e(150, "2026-06-01")]),
    p("B", [e(50, "2027-01-01")]),
  ]);
  assert.deepStrictEqual(
    out.rows.map((r) => [r.partnerName, r.monthly]),
    [["A", 150]]
  );
  assert.strictEqual(out.summary[1].value, 150);
});

test("prayer requests default to open and bucket by age", () => {
  const req = (status, received) => ({
    category: "strategic",
    status,
    dateReceived: day(received),
    dateAnswered: null,
    isUrgent: false,
    requestText: "x",
    partner: { displayName: "A", isRestricted: false },
  });
  const out = run("prayer-requests", {}, [
    req("ongoing", "2026-11-10"),
    req("ongoing", "2026-01-01"),
    req("answered", "2026-01-01"),
  ]);
  assert.strictEqual(out.rows.length, 2);
  assert.strictEqual(out.summary.find((s) => s.label === "Open 91+ days").value, 1);
});

test("needs pipeline classifies decisions", () => {
  const n = (approved) => ({
    description: "d",
    requestedAmount: 100,
    approvedAmount: approved,
    requestDate: day("2026-10-01"),
    approvedDate: approved == null ? null : day("2026-10-04"),
    isUrgent: false,
    partner: { displayName: "A", isRestricted: false },
  });
  const out = run("needs-pipeline", {}, [n(null), n(0), n(50), n(100)]);
  assert.deepStrictEqual(out.rows.map((r) => r.decision).sort(), [
    "approved",
    "declined",
    "partial",
    "pending",
  ]);
});

test("trip readiness skips minors-only items for adults", () => {
  const trip = {
    name: "T",
    startDate: day("2027-03-01"),
    requirements: [
      { id: "r1", label: "Passport", kind: "task", minorsOnly: false },
      { id: "r2", label: "Parent form", kind: "task", minorsOnly: true },
    ],
    documents: [],
    participants: [
      { id: "p1", firstName: "A", lastName: "B", dateOfBirth: day("1990-01-01"), requirementStatuses: [] },
    ],
  };
  const out = run("trip-readiness", {}, [trip]);
  assert.strictEqual(out.rows[0].total, 1);
  assert.strictEqual(out.rows[0].outstanding, "Passport");
});

test("shared audience masks restricted names and sensitive columns", () => {
  const r = getReport("mailing-list", all);
  const rows = [{ partnerName: "Mary Lou Green", line1: "1 Main", _restricted: true }];
  const shared = applyMasking(rows, r.columns, "shared")[0];
  assert.strictEqual(shared.partnerName, "M.L.G.");
  assert.strictEqual(shared.line1, null);
  assert.strictEqual(applyMasking(rows, r.columns, "admin")[0].line1, "1 Main");
});

test("key dates lists upcoming birthdays and anniversaries soonest first", () => {
  const p = {
    displayName: "A",
    isRestricted: false,
    anniversary: day("2010-12-01"),
    adults: [{ firstName: "Ann", lastName: "Lee", birthday: day("1985-11-25") }],
    children: [{ firstName: "Bo", lastName: "Lee", birthday: day("2015-06-01") }],
  };
  const out = run("key-dates", { days: "30" }, [p]);
  assert.deepStrictEqual(
    out.rows.map((r) => [r.occasion, r.daysUntil, r.turning]),
    [
      ["Birthday", 3, 41],
      ["Anniversary", 9, 16],
    ]
  );
});

test("language coverage counts restricted partners without naming them", () => {
  const p = (name, restricted, langs) => ({
    displayName: name,
    isRestricted: restricted,
    languages: langs.map((l) => ({ language: l })),
  });
  const out = run("language-coverage", {}, [
    p("A", false, ["Swahili"]),
    p("B", true, ["Swahili"]),
    p("C", false, []),
  ]);
  assert.strictEqual(out.rows[0].partners, 2);
  assert.ok(!out.rows[0].names.includes("B"));
  assert.ok(out.rows[0].names.includes("1 restricted"));
  assert.strictEqual(out.rows.at(-1).language, "(none recorded)");
});

test("last heard from flags partners with no newsletter or an old one", () => {
  const p = (name, newsletters) => ({
    displayName: name,
    isRestricted: false,
    files: newsletters.map((d) => ({ receivedDate: day(d) })),
    photos: [],
    prayerRequests: [],
    churchVisits: [],
    lastPrayedWithCongregationAt: null,
  });
  const out = run(
    "last-heard-from",
    {},
    {
      partners: [p("Fresh", ["2026-11-01"]), p("Old", ["2026-01-01"]), p("Never", [])],
    }
  );
  assert.deepStrictEqual(
    out.rows.map((r) => r.partnerName),
    ["Never", "Old"]
  );
});

test("last heard from reports the last-prayed-with-congregation date, or null when it's never been recorded", () => {
  const p = (name, lastPrayedWithCongregationAt) => ({
    displayName: name,
    isRestricted: false,
    files: [],
    photos: [],
    prayerRequests: [],
    churchVisits: [],
    lastPrayedWithCongregationAt,
  });
  const out = run("last-heard-from", {}, { partners: [p("A", day("2026-10-01")), p("B", null)] });
  assert.strictEqual(out.rows.find((r) => r.partnerName === "A").lastPrayedWithCongregation, "2026-10-01");
  assert.strictEqual(out.rows.find((r) => r.partnerName === "B").lastPrayedWithCongregation, null);
});

test("last heard from's lastPrayedWithCongregation column is masked the same way as its other date columns -- not blanked for a restricted partner, only the name is", () => {
  const r = getReport("last-heard-from", all);
  const rows = [
    {
      partnerName: "Mary Lou Green",
      newsletter: "2026-10-01",
      photo: "2026-10-01",
      prayer: "2026-10-01",
      visit: "2026-10-01",
      lastPrayedWithCongregation: "2026-10-01",
      _restricted: true,
    },
  ];
  const shared = applyMasking(rows, r.columns, "shared")[0];
  assert.strictEqual(shared.partnerName, "M.L.G.");
  // None of this report's date columns are marked `sensitive` -- restricted
  // partners still have their name reduced to initials, but these dates
  // pass through unchanged, same as every other column here.
  assert.strictEqual(shared.newsletter, "2026-10-01");
  assert.strictEqual(shared.lastPrayedWithCongregation, "2026-10-01");
});

test("dispatch health and application funnel summarize correctly", () => {
  const d = (type, hrs, err) => ({
    type,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    dispatchReviewedAt:
      hrs == null ? null : new Date(new Date("2026-11-01T00:00:00Z").getTime() + hrs * 3600000),
    groupmeError: err ? "x" : null,
    whatsappError: null,
    emailError: null,
  });
  const h = run("dispatch-health", {}, [d("a", 2, false), d("a", 4, true), d("a", null, false)]);
  assert.deepStrictEqual(
    [h.rows[0].total, h.rows[0].reviewed, h.rows[0].avgReviewHours, h.rows[0].groupmeErrors],
    [3, 2, 3, 1]
  );
  const a = (status) => ({
    status,
    createdAt: day("2026-10-01"),
    reviewedAt: status === "pending" ? null : day("2026-10-03"),
  });
  const f = run("application-funnel", {}, [
    { name: "T", applications: [a("approved"), a("declined"), a("pending"), a("approved")] },
  ]);
  assert.deepStrictEqual([f.rows[0].approved, f.rows[0].approvalRate, f.rows[0].avgDaysToReview], [2, 67, 2]);
});

test("summary tiles can carry a click-through filter that the report honours", () => {
  const req = (received) => ({
    category: "strategic",
    status: "ongoing",
    dateReceived: day(received),
    dateAnswered: null,
    isUrgent: false,
    requestText: "x",
    partner: { displayName: "A", isRestricted: false },
  });
  const all = run("prayer-requests", {}, [req("2026-11-10"), req("2026-01-01")]);
  const tile = all.summary.find((s) => s.filter && s.filter.bucket === "91+ days");
  assert.strictEqual(tile.value, 1);
  const filtered = run("prayer-requests", tile.filter, [req("2026-11-10"), req("2026-01-01")]);
  assert.strictEqual(filtered.rows.length, 1);
});

// #288: a logged contact counts as hearing from a partner, alongside a
// newsletter, but only while the contact log is on.
test("last heard from counts a logged contact as hearing from them, when the contact log is on", () => {
  const p = (name, newsletterDates, contactDates) => ({
    displayName: name,
    isRestricted: false,
    files: newsletterDates.map((d) => ({ receivedDate: day(d) })),
    photos: [],
    prayerRequests: [],
    churchVisits: [],
    contactLogs: contactDates.map((d) => ({ contactDate: day(d) })),
    lastPrayedWithCongregationAt: null,
  });
  const partners = [
    p("Old newsletter, recent call", ["2026-01-01"], ["2026-11-01"]),
    p("Old both", ["2026-01-01"], ["2026-01-15"]),
    p("Contact only", [], ["2026-11-01"]),
    p("Nothing", [], []),
  ];
  const on = run("last-heard-from", {}, { partners, contactLogOn: true });
  assert.deepStrictEqual(
    on.rows.map((r) => r.partnerName),
    ["Nothing", "Old both"],
    "recent contact (or a recent newsletter) means not quiet"
  );
  assert.strictEqual(on.rows.find((r) => r.partnerName === "Old both").contact, "2026-01-15");
  assert.match(on.notes[0], /logged contact/);

  // off: contact data is ignored even if rows carry it, exactly as before
  const off = run("last-heard-from", {}, { partners, contactLogOn: false });
  assert.deepStrictEqual(
    off.rows.map((r) => r.partnerName),
    ["Contact only", "Nothing", "Old both", "Old newsletter, recent call"],
    "newsletters alone decide: a contact-only partner has no newsletter, so it is quiet"
  );
  assert.ok(off.rows.every((r) => r.contact === null));
  assert.doesNotMatch(off.notes[0], /logged contact/);
});

test("the Data completeness report says who last edited each partner, and when", () => {
  const stamped = { lastEditedByName: "Dana Whitfield", lastEditedAt: day("2026-11-20") };
  const completeness = run("data-completeness", {}, [
    { ...stamped, displayName: "P", isRestricted: false, addresses: [], languages: [], photos: [] },
    {
      lastEditedByName: null,
      lastEditedAt: null,
      displayName: "Q",
      isRestricted: false,
      addresses: [],
      languages: [],
      photos: [],
    },
  ]);
  const byName = Object.fromEntries(completeness.rows.map((r) => [r.partnerName, [r.editedBy, r.editedOn]]));
  assert.deepStrictEqual(byName.P, ["Dana Whitfield", "2026-11-20"]);
  assert.deepStrictEqual(byName.Q, [null, null], "an unedited partner has no date");
  const keys = getReport("data-completeness", all).columns.map((c) => c.key);
  assert.ok(keys.includes("editedBy") && keys.includes("editedOn"));
  // The prayer request and one-time need reports do not carry them: the dialogs do.
  for (const id of ["prayer-requests", "needs-pipeline"]) {
    const ks = getReport(id, all).columns.map((c) => c.key);
    assert.ok(!ks.includes("editedBy") && !ks.includes("editedOn"), `${id} stays compact`);
  }
});

test("support preferences lists what partners chose, and who has nothing recorded", () => {
  const pref = (over) => ({
    selected: true,
    choice: null,
    choices: [],
    other: null,
    text: null,
    note: null,
    ...over,
  });
  const partners = [
    {
      displayName: "Ann",
      isRestricted: false,
      supportPreferences: [
        pref({ option: { group: "Logistics", label: "Airport pick-up", kind: "offer", sortOrder: 1 } }),
        pref({
          choice: "Bank transfer",
          option: { group: "Gifts", label: "How to send gifts", kind: "single", sortOrder: 1 },
        }),
        pref({
          selected: false,
          option: { group: "Prayer", label: "Group prayer", kind: "offer", sortOrder: 1 },
        }),
      ],
    },
    { displayName: "Bob", isRestricted: true, supportPreferences: [] },
  ];
  const recorded = run("support-preferences", {}, partners);
  assert.deepStrictEqual(
    recorded.rows.map((r) => [r.partnerName, r.group, r.option, r.answer]),
    [
      ["Ann", "Gifts", "How to send gifts", "Bank transfer"],
      ["Ann", "Logistics", "Airport pick-up", "Yes"],
    ]
  );
  assert.strictEqual(recorded.summary[0].value, 1);

  const none = run("support-preferences", { show: "none" }, partners);
  assert.deepStrictEqual(
    none.rows.map((r) => r.partnerName),
    ["Bob"]
  );
});
