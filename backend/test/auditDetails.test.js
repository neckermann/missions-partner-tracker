// How an audit entry's details read on the Audit log page and in the CSV.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { describeDetails } = require("../src/utils/auditDetails");

test("an old-to-new change reads as 'Field: old → new'", () => {
  assert.equal(
    describeDetails({ role: { from: "viewer", to: "editor" }, firstName: { from: null, to: "Aud" } }),
    "Role: viewer → editor; First name: none → Aud"
  );
});

test("booleans read as on/off and dates as plain dates", () => {
  assert.equal(describeDetails({ isRestricted: { from: false, to: true } }), "Is restricted: off → on");
  assert.equal(
    describeDetails({ expiresAt: { from: null, to: "2099-01-01T00:00:00.000Z" } }),
    "Expires at: none → 2099-01-01"
  );
});

test("a machine code reads as words", () => {
  assert.equal(describeDetails({ reason: "unknown_email" }), "Reason: unknown email");
  assert.equal(describeDetails({ reason: "wrong_two_factor_code" }), "Reason: wrong two factor code");
});

test("lists and secret notes read plainly, and nothing reads as empty", () => {
  assert.equal(
    describeDetails({ added: ["Ann", "Bob"], lead: { from: null, to: "Ann" } }),
    "Added: Ann, Bob; Lead: none → Ann"
  );
  assert.equal(describeDetails({ anthropicApiKey: "changed" }), "Anthropic api key: changed");
  assert.equal(describeDetails(null), "");
  assert.equal(describeDetails(undefined), "");
  assert.equal(describeDetails({}), "");
});
