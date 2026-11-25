// What makes a deployment a public demo, and what a demo never does. DEMO_RESET_TOKEN
// is never set on a real deployment (publicSettings.js and server.js key off it too).

// True on a public demo deployment. Only the web service has the variable; use isDemoInstance()
// anywhere that can run in the separate worker process (schedules, email sending).
function isDemoDeployment() {
  return Boolean(process.env.DEMO_RESET_TOKEN);
}

// True when this database is a public demo: the variable above, or the `demoMode` flag the demo
// reset writes to the settings row. The worker runs the schedules and does not get the variable,
// so the flag is what stops it emailing a demo's fake accounts and spending the email plan.
// Read at most once a minute.
let cachedDemoMode = { at: 0, value: false };
async function isDemoInstance() {
  if (isDemoDeployment()) return true;
  if (Date.now() - cachedDemoMode.at < 60000) return cachedDemoMode.value;
  const prisma = require("../prismaClient");
  let value = false;
  try {
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { demoMode: true },
    });
    value = Boolean(row?.demoMode);
  } catch {
    value = false;
  }
  cachedDemoMode = { at: Date.now(), value };
  return value;
}

// For tests: forget what isDemoInstance() last read.
function forgetDemoModeCache() {
  cachedDemoMode = { at: 0, value: false };
}

// Features a demo keeps OFF on every reset. Standing rule: a demo must not email
// its seeded accounts (fake addresses bounce and spend the email plan), so anything
// emailing people on a schedule stays off. The reset script and the seed both apply
// this, because the seed rewrites the feature list after the reset.
//
// Currently empty: key-date reminders are ON so a visitor sees the bell alert; their
// email can't go out because the daily job returns early on a demo
// (keyDateReminderScheduler.js) and sendEmail skips every send there (email.js). Add a key
// if a new scheduled email needs the flag off.
const DEMO_DISABLED_FEATURES = [];

// { feature: false } for each, to spread over a feature object.
const demoDisabledFeatureFlags = () => Object.fromEntries(DEMO_DISABLED_FEATURES.map((k) => [k, false]));

// Adding or removing a sign-in factor normally ends the account's other sessions. On a demo the
// logins are shared, so that would sign every other visitor out: leave the sessions alone there.
function endOtherSessions() {
  return isDemoDeployment() ? {} : { sessionVersion: { increment: 1 } };
}

module.exports = {
  isDemoDeployment,
  isDemoInstance,
  forgetDemoModeCache,
  endOtherSessions,
  DEMO_DISABLED_FEATURES,
  demoDisabledFeatureFlags,
};
