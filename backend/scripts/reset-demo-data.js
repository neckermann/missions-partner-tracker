// Wipes and reseeds the database with fresh fake data, for a public demo
// deployment that resets on a schedule (see ADMIN_GUIDE.md § Demo mode).
// Requires DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD so a misconfigured demo
// can't reset into a state nobody can log into. Also reads
// JOSHUA_PROJECT_API_KEY and ANTHROPIC_API_KEY if set (both optional) to
// restore those integrations after the reset wipes ChurchSettings -- see
// the comment below. Safe to run manually (`npm run demo:reset`) or via
// the opt-in POST /api/demo/reset route.
require("dotenv").config({ quiet: true });
const path = require("path");
const { execFileSync } = require("child_process");
const prisma = require("../src/prismaClient");
const { FEATURE_KEYS } = require("../src/utils/features");
const { encryptField } = require("../src/utils/crypto");

const BACKEND_DIR = path.join(__dirname, "..");

function run(cmd, args, { shell = false } = {}) {
  execFileSync(cmd, args, { cwd: BACKEND_DIR, stdio: "inherit", env: process.env, shell });
}

async function resetDemoData() {
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD must both be set to reset demo data");
  }

  // Drops and recreates the schema from migrations — simpler and more
  // robust than hand-maintaining a cascade-aware deleteMany order that
  // could drift as the schema evolves. `npx` is a .cmd file on Windows,
  // which Node genuinely cannot launch without a shell (confirmed: it
  // fails with EINVAL otherwise) — shell is scoped to just this one call,
  // which takes no variable/sensitive arguments, so there's nothing here
  // for an unescaped shell to matter for. The two `node` calls below (one
  // of which takes the admin email/password) run without a shell at
  // all — node.exe is a real executable, so execFileSync passes their
  // args through directly with no injection risk.
  //
  // No --skip-seed/--skip-generate here -- Prisma 7's `migrate reset`
  // removed both flags outright (not just renamed), and also stopped
  // auto-running the configured seed command on reset at all, so there's
  // no double-seed risk from the explicit `node prisma/seed.js` call
  // below.
  run("npx", ["prisma", "migrate", "reset", "--force"], {
    shell: process.platform === "win32",
  });

  run("node", ["prisma/seed.js"]);
  run("node", ["prisma/createAdmin.js", email, password]);

  // The "this is a live demo, here's how to log in" message is no longer
  // stuffed into aboutText -- it's rendered by DemoBanner.jsx instead,
  // from DEMO_RESET_TOKEN/DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD directly
  // (see routes/publicSettings.js), so churchName/publicTagline/aboutText
  // stay free to demonstrate what a real church's own branding looks
  // like, same as everywhere else in the seeded data.
  //
  // migrate reset above drops and recreates the schema, so ChurchSettings
  // starts empty every time -- every registry feature (see
  // src/utils/features.js) needs to be explicitly turned back on here,
  // not just left to its own default, since aiExtraction's default is off.
  // A visitor exploring the public demo should see the whole app working,
  // not accidentally find half of it toggled off.
  const allFeaturesOn = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));

  // Same reasoning as DEMO_ADMIN_EMAIL/PASSWORD above: Joshua Project's
  // API key lives in ChurchSettings now (admin-managed, not an env var --
  // see that field's comment in schema.prisma), which `migrate reset`
  // above wipes along with everything else. Optional, not required like
  // the admin credentials are: a demo without it just shows the feature
  // toggled on but no stats, same as any other instance with the feature
  // on and no key saved yet -- nothing breaks either way, this just keeps
  // this one demo's own key (set directly on its Render service, never
  // committed here) surviving a reset instead of having to be re-entered
  // through the UI every time.
  const joshuaProjectApiKey = process.env.JOSHUA_PROJECT_API_KEY;
  // Same reasoning as joshuaProjectApiKey immediately above -- the
  // Anthropic key is this demo's own (real, billable) key, set directly
  // on the Render service and never committed anywhere in this repo.
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const integrationKeys = {
    ...(joshuaProjectApiKey ? { joshuaProjectApiKey: encryptField(joshuaProjectApiKey) } : {}),
    ...(anthropicApiKey ? { anthropicApiKey: encryptField(anthropicApiKey) } : {}),
  };

  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      churchName: "Missions Partner Tracker Demo",
      publicTagline: "Supporting our missionary and organization partners around the world",
      aboutText:
        "We partner with missionaries and organizations serving around the world, supporting them in prayer, finances, and care.",
      enabledFeatures: allFeaturesOn,
      ...integrationKeys,
    },
    update: {
      churchName: "Missions Partner Tracker Demo",
      publicTagline: "Supporting our missionary and organization partners around the world",
      aboutText:
        "We partner with missionaries and organizations serving around the world, supporting them in prayer, finances, and care.",
      enabledFeatures: allFeaturesOn,
      ...integrationKeys,
    },
  });
}

if (require.main === module) {
  resetDemoData()
    .then(() => {
      console.log("Demo data reset complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { resetDemoData };
