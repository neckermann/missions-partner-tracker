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
//   keyDates -- the daily key-date reminder email (#291)
const DEMO_DISABLED_FEATURES = ["keyDates"];

// { feature: false } for each, to spread over a feature object.
const demoDisabledFeatureFlags = () => Object.fromEntries(DEMO_DISABLED_FEATURES.map((k) => [k, false]));

module.exports = { isDemoDeployment, DEMO_DISABLED_FEATURES, demoDisabledFeatureFlags };
