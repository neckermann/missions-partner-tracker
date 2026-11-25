const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listFields,
  fieldFitsKind,
  currentText,
  sameValue,
  applyField,
} = require("../src/utils/surveyFields");
const { TEMPLATES, byId, listTemplates } = require("../src/utils/surveyTemplates");

test("only a short, safe list of fields can be linked, and each fits certain question kinds", () => {
  const keys = listFields().map((f) => f.key);
  assert.ok(keys.includes("primaryPhone") && keys.includes("photo"));
  for (const never of ["isPublic", "isRestricted", "displayName", "contactLevel", "latitude"]) {
    assert.ok(!keys.includes(never), `${never} must not be updatable from a survey`);
  }
  assert.equal(fieldFitsKind("primaryPhone", "text"), true);
  assert.equal(fieldFitsKind("primaryPhone", "multiple"), false);
  assert.equal(fieldFitsKind("contactMethod", "single"), true);
  assert.equal(fieldFitsKind("photo", "photo"), true);
  assert.equal(fieldFitsKind("photo", "text"), false);
  assert.equal(fieldFitsKind("nope", "text"), false);
});

test("reads the primary adult for a family and the partner itself for an organization", () => {
  const family = {
    partner: { kind: "missionary" },
    adults: [
      { id: "a", phone1: "111", isPrimaryContact: false },
      { id: "b", phone1: "222", isPrimaryContact: true },
    ],
  };
  assert.equal(currentText(family, "primaryPhone"), "222");
  const org = { partner: { kind: "organization", contactPhone: "333" }, adults: [] };
  assert.equal(currentText(org, "primaryPhone"), "333");
  assert.equal(sameValue(" A@B.org ", "a@b.org"), true);
});

test("applying checks the value and writes it, or says why not", async () => {
  const writes = [];
  const tx = {
    adult: { update: async (a) => writes.push(["adult", a.data]) },
    partner: { update: async (a) => writes.push(["partner", a.data]) },
  };
  const ctx = { partner: { id: "p", kind: "missionary" }, adults: [{ id: "a", isPrimaryContact: true }] };
  assert.deepEqual(await applyField(tx, ctx, "primaryPhone", "+1 (337) 555-0100"), {
    applied: "+1 (337) 555-0100",
  });
  assert.deepEqual(writes[0], ["adult", { phone1: "+1 (337) 555-0100" }]);
  assert.match((await applyField(tx, ctx, "primaryPhone", "12")).error, /phone/);
  assert.match((await applyField(tx, ctx, "primaryEmail", "nope")).error, /email/);
  assert.match((await applyField(tx, ctx, "contactMethod", "carrier pigeon")).error, /Use one of/);
  assert.ok(
    (
      await applyField(
        tx,
        { partner: { id: "p", kind: "missionary" }, adults: [] },
        "primaryPhone",
        "3375550100"
      )
    ).error
  );
  assert.ok((await applyField(tx, ctx, "photo", "x")).error);
  assert.deepEqual(await applyField(tx, ctx, "emergencyContactName", "Sam"), { applied: "Sam" });
  assert.deepEqual(writes.at(-1), ["partner", { emergencyContactName: "Sam" }]);
});

test("every template question that links a field links one that fits its kind", () => {
  assert.ok(listTemplates().length >= 3);
  for (const t of TEMPLATES) {
    assert.ok(byId(t.id));
    assert.ok(t.questions.length > 0 && t.intro);
    for (const q of t.questions) {
      if (q.field) assert.ok(fieldFitsKind(q.field, q.kind), `${t.id}: ${q.label}`);
      if (q.kind === "single" || q.kind === "multiple") assert.ok(q.choices?.length, `${t.id}: ${q.label}`);
    }
  }
  assert.ok(!JSON.stringify(TEMPLATES).match(/church name|Hillside/i));
});
