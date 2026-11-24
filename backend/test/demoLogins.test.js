// The published demo guest logins are defined once and read by both the seed
// (which creates them) and the demo banner (which advertises them).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  demoGuestLogins,
  demoGuestPassword,
  DEMO_CARE_MEMBER_EMAIL,
  DEMO_TRIP_LEADER_EMAIL,
} = require("../src/utils/demoLogins");

test("the password is read at call time, so the seed and the banner always agree", () => {
  const original = process.env.DEMO_GUEST_PASSWORD;
  try {
    delete process.env.DEMO_GUEST_PASSWORD;
    assert.equal(demoGuestPassword(), "TryTheGuestDemo2026!");
    process.env.DEMO_GUEST_PASSWORD = "changed";
    assert.equal(demoGuestPassword(), "changed");
    assert.ok(demoGuestLogins().every((g) => g.password === "changed"));
  } finally {
    if (original === undefined) delete process.env.DEMO_GUEST_PASSWORD;
    else process.env.DEMO_GUEST_PASSWORD = original;
  }
});

test("lists exactly the two accounts the seed creates, each with a label and summary", () => {
  const logins = demoGuestLogins();
  assert.deepEqual(
    logins.map((g) => g.email),
    [DEMO_CARE_MEMBER_EMAIL, DEMO_TRIP_LEADER_EMAIL]
  );
  assert.ok(logins.every((g) => g.key && g.label && g.summary && g.password));
});
