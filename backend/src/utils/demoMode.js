// What makes a deployment a public demo, and what a demo never does. DEMO_RESET_TOKEN
// is never set on a real deployment (publicSettings.js and server.js key off it too).

// True on a public demo deployment.
function isDemoDeployment() {
  return Boolean(process.env.DEMO_RESET_TOKEN);
}

// Features a demo keeps OFF on every reset. Standing rule: a demo must not email
// its seeded accounts (fake addresses bounce and spend the email plan), so anything
// emailing people on a schedule stays off. The reset script and the seed both apply
// this, because the seed rewrites the feature list after the reset.
//
// Currently empty: key-date reminders are ON so a visitor sees the bell alert; their
// email can't go out because the daily job returns early when DEMO_RESET_TOKEN is
// set (keyDateReminderScheduler.js). Add a key if a new scheduled email needs the flag off.
const DEMO_DISABLED_FEATURES = [];

// { feature: false } for each, to spread over a feature object.
const demoDisabledFeatureFlags = () => Object.fromEntries(DEMO_DISABLED_FEATURES.map((k) => [k, false]));

// Adding or removing a sign-in factor normally ends the account's other sessions. On a demo the
// logins are shared, so that would sign every other visitor out: leave the sessions alone there.
function endOtherSessions() {
  return isDemoDeployment() ? {} : { sessionVersion: { increment: 1 } };
}

module.exports = { isDemoDeployment, endOtherSessions, DEMO_DISABLED_FEATURES, demoDisabledFeatureFlags };
