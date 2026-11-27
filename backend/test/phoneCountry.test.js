const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  DEFAULT_PHONE_COUNTRY,
  isValidPhoneCountry,
  getPhoneCountry,
  setPhoneCountry,
} = require("../src/utils/phoneCountry");
const { phoneSchema, normalizePhone } = require("../src/utils/contactFormat");

test.afterEach(() => setPhoneCountry("US"));

test("the country is the United States until a church sets another", () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, "US");
  assert.equal(getPhoneCountry(), "US");
});

test("only a country code libphonenumber knows is accepted", () => {
  for (const ok of ["US", "GB", "KE", "BR", "IN", "PH", "MX", "JP", "DE", "NG", "CA"]) {
    assert.equal(isValidPhoneCountry(ok), true, ok);
  }
  for (const bad of ["ZZ", "us", "USA", "", null, undefined, 1, "U"]) {
    assert.equal(isValidPhoneCountry(bad), false, String(bad));
  }
});

test("setting an unknown country falls back to the default instead of breaking saving", () => {
  assert.equal(setPhoneCountry("GB"), "GB");
  assert.equal(getPhoneCountry(), "GB");
  assert.equal(setPhoneCountry("ZZ"), "US");
  assert.equal(getPhoneCountry(), "US");
  assert.equal(setPhoneCountry(undefined), "US");
});

test("the zod phone check reads a number with no + in the church's country, and a + number in its own", () => {
  const schema = z.object({ phone: phoneSchema(z) });
  assert.equal(schema.safeParse({ phone: "020 7946 0958" }).success, false, "not a US number");
  setPhoneCountry("GB");
  assert.deepEqual(schema.parse({ phone: "020 7946 0958" }), { phone: "+442079460958" });
  assert.deepEqual(schema.parse({ phone: "+1 (506) 555-0259" }), { phone: "+15065550259" });
  assert.equal(schema.safeParse({ phone: "12345" }).success, false, "too short in any country");
  // The check is length and shape only, so a 10-digit American number typed plainly is read as a UK one:
  // someone in a UK church types +1 for an American number.
  assert.deepEqual(schema.parse({ phone: "(506) 555-0259" }), { phone: "+445065550259" });
  setPhoneCountry("US");
  assert.deepEqual(schema.parse({ phone: "(506) 555-0259" }), { phone: "+15065550259" });
});

test("an explicit country still wins over the church's", () => {
  setPhoneCountry("GB");
  assert.deepEqual(z.object({ p: phoneSchema(z, "US") }).parse({ p: "(506) 555-0259" }), {
    p: "+15065550259",
  });
  assert.deepEqual(normalizePhone("020 7946 0958", "GB"), { value: "+442079460958" });
});
