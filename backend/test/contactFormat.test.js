const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  DEFAULT_PHONE_COUNTRY,
  normalizePhone,
  normalizeEmail,
  phoneSchema,
  emailSchema,
} = require("../src/utils/contactFormat");

test("a phone is saved in international form, however it was typed", () => {
  for (const typed of [
    "(506) 555-0259",
    "506-555-0259",
    "506.555.0259",
    "5065550259",
    "1 506 555 0259",
    "+1 (506) 555-0259",
  ]) {
    assert.deepEqual(normalizePhone(typed), { value: "+15065550259" }, typed);
  }
  assert.deepEqual(normalizePhone("+44 20 7946 0958"), { value: "+442079460958" });
  assert.deepEqual(normalizePhone("+33 1 23 45 67 89"), { value: "+33123456789" });
});

test("the country comes from the church, and the United States when none is given", () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, "US");
  assert.deepEqual(normalizePhone("020 7946 0958", "GB"), { value: "+442079460958" });
  assert.deepEqual(normalizePhone("2079460958"), { value: "+12079460958" });
});

test("fictional 555 numbers still save, so demos and examples keep working", () => {
  assert.deepEqual(normalizePhone("(555) 123-4567"), { value: "+15551234567" });
  assert.deepEqual(normalizePhone("555-555-0100"), { value: "+15555550100" });
});

test("junk, letters and numbers of the wrong length are refused in plain words", () => {
  for (const bad of [
    "dsafdsfsadf",
    "12345",
    "555-0259",
    "+1 506 555",
    "1234567890123456",
    "call me",
    "506-555-0259 ext 4",
  ]) {
    const result = normalizePhone(bad);
    assert.match(result.error, /doesn't look like a phone number/, bad);
    assert.equal(result.value, undefined);
  }
  assert.ok(normalizePhone("1".repeat(41)).error, "an over-long entry is refused");
});

test("blank means no phone, not a problem", () => {
  assert.deepEqual(normalizePhone(""), { value: null });
  assert.deepEqual(normalizePhone("   "), { value: null });
  assert.deepEqual(normalizePhone(null), { value: null });
  assert.deepEqual(normalizePhone(undefined), { value: null });
});

test("an email is trimmed and lower case; anything else that isn't one is refused", () => {
  assert.deepEqual(normalizeEmail("  Sam.Doe@Example.ORG "), { value: "sam.doe@example.org" });
  assert.deepEqual(normalizeEmail(""), { value: null });
  assert.deepEqual(normalizeEmail(null), { value: null });
  for (const bad of ["nope", "a@b", "a b@c.org", "@c.org", "a@@c.org", `${"x".repeat(200)}@c.org`]) {
    assert.match(normalizeEmail(bad).error, /doesn't look like an email address/, bad);
  }
});

test("the zod pieces turn blank into null, save the normal form and report the plain message", () => {
  const schema = z.object({ phone: phoneSchema(z), email: emailSchema(z) });
  assert.deepEqual(schema.parse({ phone: "(506) 555-0259", email: "A@B.org" }), {
    phone: "+15065550259",
    email: "a@b.org",
  });
  assert.deepEqual(schema.parse({ phone: "", email: null }), { phone: null, email: null });
  assert.deepEqual(schema.parse({}), { phone: null, email: null });
  const bad = schema.safeParse({ phone: "dsafdsfsadf", email: "nope" });
  assert.equal(bad.success, false);
  const messages = bad.error.issues.map((i) => i.message);
  assert.ok(messages.some((m) => /phone number/.test(m)));
  assert.ok(messages.some((m) => /email address/.test(m)));
  assert.deepEqual(bad.error.issues.map((i) => i.path[0]).sort(), ["email", "phone"]);
});
