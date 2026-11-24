// #327 Finding 10 -- a shared report's "shared" audience (anything that
// leaves the signed-in app, e.g. a scheduled report email) masks a
// restricted partner's name. This now respects
// ChurchSettings.restrictedPartnerInitialsEnabled too, same as every
// other masking site -- but a flattened report row only ever carries the
// one partnerName string column (no separate fieldDisplayName column the
// way a real Partner record has), so this path falls back to the fixed
// generic label only, not fieldDisplayName, when initials are off.
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMasking } = require("../src/reporting/masking");

const columns = [
  { key: "partnerName", label: "Partner" },
  { key: "amount", label: "Amount", sensitive: true },
];

function row(overrides) {
  return { partnerName: "Jordan Rivera", amount: 500, _restricted: false, ...overrides };
}

test("admin audience is never masked, regardless of settings", () => {
  const [masked] = applyMasking([row({ _restricted: true })], columns, "admin", {
    restrictedPartnerInitialsEnabled: false,
  });
  assert.equal(masked.partnerName, "Jordan Rivera");
});

test("shared audience, no settings at all: defaults to initials (opt-out)", () => {
  const [masked] = applyMasking([row({ _restricted: true })], columns, "shared");
  assert.equal(masked.partnerName, "J.R.");
  assert.equal(masked.amount, null, "sensitive columns are still blanked");
});

test("shared audience, settings false: falls back to the fixed generic label", () => {
  const [masked] = applyMasking([row({ _restricted: true })], columns, "shared", {
    restrictedPartnerInitialsEnabled: false,
  });
  assert.equal(masked.partnerName, "A restricted-access partner");
});

test("a non-restricted row is never masked, regardless of settings", () => {
  const [masked] = applyMasking([row({ _restricted: false })], columns, "shared", {
    restrictedPartnerInitialsEnabled: false,
  });
  assert.equal(masked.partnerName, "Jordan Rivera");
  assert.equal(masked.amount, 500);
});
