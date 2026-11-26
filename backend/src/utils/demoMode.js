// What makes a deployment a public demo, and what a demo never does. DEMO_RESET_TOKEN
// is never set on a real deployment (publicSettings.js and server.js key off it too).

// True on a public demo deployment. Only the web service has the variable; use isDemoInstance()
// anywhere that can run in the separate worker process (the schedules).
function isDemoDeployment() {
  return Boolean(process.env.DEMO_RESET_TOKEN);
}

// True when this database is a public demo: the variable above, or the `demoMode` flag the demo
// reset writes to the settings row. The worker runs the schedules and does not get the variable,
// so the flag is what stops its schedules emailing a demo's fake accounts and spending the email plan.
// Only scheduled sends are skipped: an email a person adds or clicks to send goes out as anywhere else.
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
// emailing people on a schedule stays off (anything a person sends by hand still goes). The reset script and the seed both apply
// this, because the seed rewrites the feature list after the reset.
//
// Currently empty: key-date reminders are ON so a visitor sees the bell alert; their
// email can't go out because the daily job returns early on a demo
// (keyDateReminderScheduler.js, and the other scheduled senders). Add a key
// if a new scheduled email needs the flag off.
const DEMO_DISABLED_FEATURES = [];

// { feature: false } for each, to spread over a feature object.
const demoDisabledFeatureFlags = () => Object.fromEntries(DEMO_DISABLED_FEATURES.map((k) => [k, false]));

// The owner's own test deployment (the dev demo): a demo that is deliberately NOT guarded. It keeps its real
// integration keys so the owner can try sends and take screenshots of what can't be seen otherwise, and it
// publishes no logins. Set DEMO_TESTING_SITE=true only there; never on a demo the public can reach.
function isTestingSite() {
  return process.env.DEMO_TESTING_SITE === "true";
}

// A public demo that anyone can sign in to: it must never send anything that leaves the app, spend the
// owner's money, or let a visitor change the shared logins or integration settings. Read from the
// environment at call time (the web service has it; see isDemoInstance for the worker's schedules).
function isGuardedDemo() {
  return isDemoDeployment() && !isTestingSite();
}

// The same question for code that can run in the worker, which does not get DEMO_RESET_TOKEN: a demo is
// also recognised by the `demoMode` flag the reset writes. DEMO_TESTING_SITE must be set on the worker
// too, on the owner's test deployment, or its scheduled sends are held back as on any demo.
async function isGuardedDemoInstance() {
  return !isTestingSite() && (await isDemoInstance());
}

// Route middleware: refuse `what` on a guarded demo, say so plainly.
function refuseOnGuardedDemo(what) {
  return (req, res, next) => {
    if (isGuardedDemo()) return res.status(403).json({ error: `${what} isn't available on the public demo` });
    next();
  };
}

// Adding or removing a sign-in factor normally ends the account's other sessions. On a demo the
// logins are shared, so that would sign every other visitor out: leave the sessions alone there.
function endOtherSessions() {
  return isDemoDeployment() ? {} : { sessionVersion: { increment: 1 } };
}

module.exports = {
  isDemoDeployment,
  isTestingSite,
  isGuardedDemo,
  isGuardedDemoInstance,
  refuseOnGuardedDemo,
  isDemoInstance,
  forgetDemoModeCache,
  endOtherSessions,
  DEMO_DISABLED_FEATURES,
  demoDisabledFeatureFlags,
};
