// A shared report's "shared" audience (anything that leaves the signed-in app, e.g. a
// scheduled report email) masks a restricted partner's name, respecting
// ChurchSettings.restrictedPartnerInitialsEnabled like every other masking site. A flattened
// report row only carries a partnerName string (no separate fieldDisplayName), so with
// initials off it falls back to the fixed generic label.
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

test("shared audience: a restricted row uses the initials built from its adults when it has them", () => {
  const initialsByName = new Map([["Tim and Sarah Smith", "T.S. and S.S."]]);
  const [masked] = applyMasking(
    [row({ partnerName: "Tim and Sarah Smith", _restricted: true })],
    columns,
    "shared",
    undefined,
    initialsByName
  );
  assert.equal(masked.partnerName, "T.S. and S.S.");
});

test("shared audience: a restricted row not in the lookup still falls back to initials of its name, never the name", () => {
  const [masked] = applyMasking(
    [row({ partnerName: "Tim and Sarah Smith", _restricted: true })],
    columns,
    "shared",
    undefined,
    new Map()
  );
  assert.equal(masked.partnerName, "T.A.S.S.");
});

test("shared audience: initials switched off still gives the generic label, whatever the lookup holds", () => {
  const [masked] = applyMasking(
    [row({ partnerName: "Tim and Sarah Smith", _restricted: true })],
    columns,
    "shared",
    { restrictedPartnerInitialsEnabled: false },
    new Map([["Tim and Sarah Smith", "T.S. and S.S."]])
  );
  assert.equal(masked.partnerName, "A restricted-access partner");
});
