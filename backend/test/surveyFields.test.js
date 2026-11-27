const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listFields,
  fieldFitsKind,
  currentText,
  sameValue,
  applyField,
  FIELDS,
  presentation,
  presentQuestion,
  pageQuestion,
  problemWithAnswer,
} = require("../src/utils/surveyFields");

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
  // A phone is saved in the one international form, however it was typed.
  assert.deepEqual(await applyField(tx, ctx, "primaryPhone", "+1 (337) 555-0100"), {
    applied: "+13375550100",
  });
  assert.deepEqual(writes[0], ["adult", { phone1: "+13375550100" }]);
  assert.deepEqual(await applyField(tx, ctx, "primaryEmail", " Sam@Example.ORG "), {
    applied: "sam@example.org",
  });
  assert.match((await applyField(tx, ctx, "primaryPhone", "12")).error, /phone/);
  assert.match((await applyField(tx, ctx, "primaryEmail", "nope")).error, /email/);
  assert.match((await applyField(tx, ctx, "primaryPhone", "dsafdsfsadf")).error, /phone number/);
  assert.match((await applyField(tx, ctx, "contactMethod", "carrier pigeon")).error, /Choose one of/);
  // The words a person reads are accepted and saved as the stored value.
  assert.deepEqual(await applyField(tx, ctx, "contactMethod", "Text message"), { applied: "text" });
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

test("two spellings of one number or address are the same answer; other fields compare as text", () => {
  assert.equal(sameValue("(506) 555-0259", "506 555 0259", "primaryPhone"), true);
  assert.equal(sameValue("+1 506-555-0259", "(506) 555-0259", "emergencyContactPhone"), true);
  assert.equal(sameValue("(506) 555-0259", "(506) 555-0260", "primaryPhone"), false);
  assert.equal(sameValue("Sam@X.org", "sam@x.org", "primaryEmail"), true);
  assert.equal(sameValue("Call", "call", "contactMethod"), true);
  assert.equal(sameValue("Phone call", "call", "contactMethod"), true);
  assert.equal(sameValue(" A ", "a"), true);
});

test("a question tells the page which input to use; a contact method always has the fixed list", () => {
  assert.equal(presentation("primaryPhone").inputType, "tel");
  assert.equal(presentation("emergencyContactPhone").inputType, "tel");
  assert.equal(presentation("primaryEmail").inputType, "email");
  assert.equal(presentation("emergencyContactEmail").inputType, "email");
  assert.equal(presentation("emergencyContactName").inputType, "line");
  assert.equal(presentation("overviewShort").inputType, "line");
  assert.deepEqual(presentation("photo"), {});
  assert.deepEqual(presentation(null), {});
  const method = presentation("contactMethod");
  assert.deepEqual(method.choices, ["call", "text", "email", "whatsapp", "signal", "messenger", "other"]);
  assert.equal(method.labels.call, "Phone call");
  assert.equal(method.allowOther, false);

  const authored = {
    id: "q",
    kind: "single",
    field: "contactMethod",
    choices: ["Call me"],
    allowOther: true,
  };
  assert.deepEqual(presentQuestion(authored).choices, method.choices, "authored choices are ignored");
  assert.equal(presentQuestion(authored).allowOther, false);
  const page = pageQuestion(authored);
  assert.equal(page.inputType, "contactMethod");
  assert.equal(page.labels.text, "Text message");
  const plain = pageQuestion({ id: "r", kind: "text", field: null, choices: [], allowOther: false });
  assert.equal(plain.inputType, null);
  assert.equal(plain.labels, null);
});

test("a typed answer is checked by the field its question is linked to", () => {
  assert.equal(problemWithAnswer("primaryPhone", "(506) 555-0259"), null);
  assert.match(problemWithAnswer("primaryPhone", "dsafdsfsadf"), /phone number/);
  assert.match(problemWithAnswer("emergencyContactPhone", "12"), /phone number/);
  assert.match(problemWithAnswer("primaryEmail", "nope"), /email address/);
  assert.match(problemWithAnswer("emergencyContactEmail", "a@b"), /email address/);
  assert.match(problemWithAnswer("emergencyContactName", "x".repeat(121)), /120 characters/);
  assert.equal(problemWithAnswer("primaryPhone", ""), null, "blank is never a problem here");
  assert.equal(problemWithAnswer("photo", "anything"), null);
  assert.equal(problemWithAnswer(null, "anything"), null);
});

test("every field a survey can update has a check and an input, so a new one cannot skip them (#548)", () => {
  for (const [key, field] of Object.entries(FIELDS)) {
    if (field.photo || field.support) continue;
    assert.equal(
      typeof field.normalize,
      "function",
      `${key} needs a normalize(value) that returns { value } or { error }`
    );
    assert.ok(
      field.inputType,
      `${key} needs an inputType (tel, email, line, contactMethod) for the survey page`
    );
    assert.ok(field.write, `${key} needs a write`);
    // Junk the check must refuse for the kinds of value it takes; anything may be blank.
    assert.equal(field.normalize("").error, undefined, `${key}: blank is not an error`);
  }
  for (const key of ["primaryPhone", "emergencyContactPhone"]) {
    assert.ok(FIELDS[key].normalize("dsafdsfsadf").error, `${key} refuses a value that is not a phone`);
  }
  for (const key of ["primaryEmail", "emergencyContactEmail"]) {
    assert.ok(FIELDS[key].normalize("not an email").error, `${key} refuses a value that is not an email`);
  }
  assert.ok(FIELDS.contactMethod.normalize("carrier pigeon").error);
  assert.ok(FIELDS.mailingAddress.normalize("not json").error);
});
