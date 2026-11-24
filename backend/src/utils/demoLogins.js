// The published guest logins on a public demo (#289, #356): one place that
// defines them, so the seed that CREATES the accounts (prisma/seed.js) and the
// demo banner that ADVERTISES them (routes/publicSettings.js) can't drift.
//
// They are published on purpose, like the demo admin's, so a visitor can see
// what a care team member and a trip leader get. Two-factor is off on just
// these two accounts, because a shared account can't enrol an authenticator
// without locking every other visitor out (see demo/README.md). Demo-only:
// publicSettings.js hands these out only when DEMO_RESET_TOKEN is set, which
// is never the case on a real church's deployment.

const DEMO_CARE_MEMBER_EMAIL = "care.member@example.org";
const DEMO_TRIP_LEADER_EMAIL = "trip.leader@example.org";

// Read at call time (not module load) so the seed and the banner always agree
// on the value the demo's environment currently has.
function demoGuestPassword() {
  return process.env.DEMO_GUEST_PASSWORD || "TryTheGuestDemo2026!";
}

// For the demo banner. `summary` says what the login gets, in a sentence.
function demoGuestLogins() {
  const password = demoGuestPassword();
  return [
    {
      key: "careTeamMember",
      label: "Care team member",
      email: DEMO_CARE_MEMBER_EMAIL,
      password,
      summary:
        "Looks after a few partners: updates their profile, logs contacts and prayer requests (staff approve what goes out), and sees what's coming up for them.",
    },
    {
      key: "tripLeader",
      label: "Trip leader",
      email: DEMO_TRIP_LEADER_EMAIL,
      password,
      summary: "Runs one upcoming trip and sees that trip's partner, read-only.",
    },
  ];
}

module.exports = { DEMO_CARE_MEMBER_EMAIL, DEMO_TRIP_LEADER_EMAIL, demoGuestPassword, demoGuestLogins };
