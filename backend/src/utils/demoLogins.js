// The published guest logins on a public demo: one definition so the seed that
// CREATES them (prisma/seed.js) and the demo banner that ADVERTISES them
// (routes/publicSettings.js) can't drift.
//
// Published on purpose, like the demo admin's, so a visitor can see what a care team
// member and a trip leader get. Two-factor is off on just these two because a shared
// account can't enrol an authenticator without locking out other visitors (see
// demo/README.md). publicSettings.js hands them out only when DEMO_RESET_TOKEN is set.

// The guests share the demo admin's email domain (DEMO_ADMIN_EMAIL's) so the three
// logins look related; example.org (reserved, never delivers) if unset. Read at call time.
function demoEmailDomain() {
  const admin = process.env.DEMO_ADMIN_EMAIL || "";
  const at = admin.lastIndexOf("@");
  return at > 0 && at < admin.length - 1
    ? admin
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : "example.org";
}
const demoCareMemberEmail = () => `care.member@${demoEmailDomain()}`;
const demoTripLeaderEmail = () => `trip.leader@${demoEmailDomain()}`;

// One password for every published login: the demo admin's (DEMO_ADMIN_PASSWORD)
// unless DEMO_GUEST_PASSWORD overrides it, else a fixed default. Read at call time
// so the seed and the banner agree.
const DEFAULT_DEMO_PASSWORD = "TryTheDemo2026!";
function demoGuestPassword() {
  return process.env.DEMO_GUEST_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || DEFAULT_DEMO_PASSWORD;
}

// For the demo banner. `summary` says what the login gets in a sentence.
function demoGuestLogins() {
  const password = demoGuestPassword();
  return [
    {
      key: "careTeamMember",
      label: "Care team member",
      email: demoCareMemberEmail(),
      password,
      summary:
        "Looks after a few partners: updates their profile, logs contacts and prayer requests (staff approve what goes out), and sees what's coming up for them.",
    },
    {
      key: "tripLeader",
      label: "Trip leader",
      email: demoTripLeaderEmail(),
      password,
      summary: "Runs one upcoming trip and sees that trip's partner, read-only.",
    },
  ];
}

module.exports = {
  demoEmailDomain,
  demoCareMemberEmail,
  demoTripLeaderEmail,
  demoGuestPassword,
  demoGuestLogins,
};
