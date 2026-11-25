// What makes a deployment a public demo, and what a demo never does. Demo-only:
// DEMO_RESET_TOKEN is never set on a real church's deployment (see
// routes/publicSettings.js and server.js, which key off the same variable).

// True on a public demo deployment.
function isDemoDeployment() {
  return Boolean(process.env.DEMO_RESET_TOKEN);
}

// Features a demo keeps OFF on every reset, even though it turns the rest on.
// The standing rule: a demo must not send email to its seeded accounts (they
// are fake addresses, so mail to them just bounces and spends the email
// plan's limit), so anything that emails people on its own schedule stays off
// there. The reset script and the seed both apply this, because the seed
// rewrites the feature list after the reset script does.
//
// Currently empty: the key-date reminders (#291) are ON for a demo so a visitor sees the bell
// alert (#365). Their email can't go out anyway, because the daily job returns early on any
// deployment where DEMO_RESET_TOKEN is set (keyDateReminderScheduler.js). Add a feature key here
// if a new scheduled email ever needs the flag itself kept off.
const DEMO_DISABLED_FEATURES = [];

// { feature: false } for each, to spread over a feature object.
const demoDisabledFeatureFlags = () => Object.fromEntries(DEMO_DISABLED_FEATURES.map((k) => [k, false]));

// Adding or removing a sign-in factor normally ends the account's other sessions. On a demo the
// logins are shared, so that would sign every other visitor out: leave the sessions alone there.
function endOtherSessions() {
  return isDemoDeployment() ? {} : { sessionVersion: { increment: 1 } };
}

module.exports = { isDemoDeployment, endOtherSessions, DEMO_DISABLED_FEATURES, demoDisabledFeatureFlags };
