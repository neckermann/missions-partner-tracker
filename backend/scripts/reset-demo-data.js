// Wipes and reseeds the database with fresh fake data, for a public demo
// deployment that resets on a schedule (see ADMIN_GUIDE.md § Demo mode).
// Requires DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD so a misconfigured demo
// can't reset into a state nobody can log into. Safe to run manually
// (`npm run demo:reset`) or via the opt-in POST /api/demo/reset route.
require("dotenv").config();
const path = require("path");
const { execFileSync } = require("child_process");
const prisma = require("../src/prismaClient");

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
  run("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed", "--skip-generate"], {
    shell: process.platform === "win32",
  });
  run("node", ["prisma/seed.js"]);
  run("node", ["prisma/createAdmin.js", email, password]);

  const demoNotice = `This is a live public demo of Missions Partner Tracker, running against fake data. It resets automatically on a schedule — nothing you do here is permanent. Sign in at /login with ${email} / ${password} to try the admin dashboard.`;

  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      churchName: "Demo Church",
      publicTagline: "Live public demo — resets automatically",
      aboutText: demoNotice,
    },
    update: {
      churchName: "Demo Church",
      publicTagline: "Live public demo — resets automatically",
      aboutText: demoNotice,
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
