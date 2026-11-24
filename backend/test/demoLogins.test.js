// The published demo guest logins are defined once and read by both the seed
// (which creates them) and the demo banner (which advertises them).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  demoGuestLogins,
  demoGuestPassword,
  demoCareMemberEmail,
  demoTripLeaderEmail,
  demoEmailDomain,
} = require("../src/utils/demoLogins");

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("every login shares one password: the guests follow the demo admin's", () => {
  withEnv({ DEMO_GUEST_PASSWORD: undefined, DEMO_ADMIN_PASSWORD: "admin-pw" }, () => {
    assert.equal(demoGuestPassword(), "admin-pw");
    assert.ok(demoGuestLogins().every((g) => g.password === "admin-pw"));
  });
});

test("DEMO_GUEST_PASSWORD overrides it, and a fixed default covers neither being set", () => {
  withEnv({ DEMO_GUEST_PASSWORD: "guest-pw", DEMO_ADMIN_PASSWORD: "admin-pw" }, () => {
    assert.equal(demoGuestPassword(), "guest-pw");
  });
  withEnv({ DEMO_GUEST_PASSWORD: undefined, DEMO_ADMIN_PASSWORD: undefined }, () => {
    assert.equal(demoGuestPassword(), "TryTheDemo2026!");
  });
});

test("the password is read at call time, so the seed and the banner always agree", () => {
  withEnv({ DEMO_GUEST_PASSWORD: undefined, DEMO_ADMIN_PASSWORD: "first" }, () => {
    assert.equal(demoGuestPassword(), "first");
    process.env.DEMO_ADMIN_PASSWORD = "second";
    assert.equal(demoGuestPassword(), "second");
  });
});

test("the guests share the demo admin's email domain, and example.org when there is none", () => {
  withEnv({ DEMO_ADMIN_EMAIL: "demo@missionspartnertracker.com" }, () => {
    assert.equal(demoEmailDomain(), "missionspartnertracker.com");
    assert.equal(demoCareMemberEmail(), "care.member@missionspartnertracker.com");
    assert.equal(demoTripLeaderEmail(), "trip.leader@missionspartnertracker.com");
  });
  withEnv({ DEMO_ADMIN_EMAIL: "Demo@Church.ORG" }, () => {
    assert.equal(demoEmailDomain(), "church.org", "case-insensitive");
  });
  for (const bad of [undefined, "", "no-at-sign", "trailing@", "@leading.org"]) {
    withEnv({ DEMO_ADMIN_EMAIL: bad }, () =>
      assert.equal(demoEmailDomain(), "example.org", `for ${JSON.stringify(bad)}`)
    );
  }
});

test("lists exactly the two accounts the seed creates, each with a label and summary", () => {
  withEnv({ DEMO_ADMIN_EMAIL: "demo@missionspartnertracker.com" }, () => {
    const logins = demoGuestLogins();
    assert.deepEqual(
      logins.map((g) => g.email),
      [demoCareMemberEmail(), demoTripLeaderEmail()]
    );
    assert.ok(logins.every((g) => g.key && g.label && g.summary && g.password));
  });
});
