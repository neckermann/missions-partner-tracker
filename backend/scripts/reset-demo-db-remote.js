// Runs scripts/reset-demo-data.js's resetDemoData() against the LIVE demo Postgres on Render,
// from a local machine. Needed after a migration squash: the squash replaces the migration
// folder with one the live _prisma_migrations table has no record of, so Render's
// preDeployCommand (`prisma migrate deploy`) fails with P3018 and the deploy is wedged. Running
// a real `migrate reset --force` here recreates from the squashed migration, so the next
// deploy's `migrate deploy` no-ops.
//
// What this needs beyond `npm run demo:reset`:
// 1. DEMO_DATABASE_URL, not DATABASE_URL (this repo's .env has no bare DATABASE_URL; Render
// injects it on the service). It is remapped into DATABASE_URL before requiring
// reset-demo-data.js.
// 2. `?sslmode=require` appended to that URL. prismaClient.js's parseDatabaseUrl() turns TLS on
// only when sslmode is literally "require", and without it the @prisma/adapter-pg path fails
// with P1017 on every query (`migrate reset` itself tolerates the bare string, which hides this
// until createAdmin.js's first upsert).
//
// Usage: node scripts/reset-demo-db-remote.js
// Needs the env vars reset-demo-data.js needs (DEMO_ADMIN_EMAIL/PASSWORD, GROUPME_*/POSTMARK_*,
// etc.), which live in demo/.env at the repo root (gitignored), not backend/.env. They are
// loaded by explicit path, so cwd doesn't matter.
//
// Prisma's AI-agent safety guard also requires PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION, set
// to the verbatim text of the user's own latest message consenting to this destructive action on
// this database. It is deliberately not hardcoded (a canned consent would defeat the guard); set
// it per run:
//
//   PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<their message>" node
// scripts/reset-demo-db-remote.js
//
// Keep this script until 1.0.0: migrations are squashed on every schema change until then
// (SPEC.md § 8.3), and this is the fastest way to recover the live demo DB.
require("dotenv").config({ path: require("path").join(__dirname, "../../demo/.env"), quiet: true });

const demoUrl = process.env.DEMO_DATABASE_URL;
if (!demoUrl) {
  console.error("DEMO_DATABASE_URL not set");
  process.exit(1);
}
process.env.DATABASE_URL = demoUrl.includes("sslmode=") ? demoUrl : `${demoUrl}?sslmode=require`;

if (!process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION) {
  console.error(
    "PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION not set -- this must be the user's own verbatim " +
      "consent for THIS reset, not reused from a prior run."
  );
  process.exit(1);
}

const { resetDemoData } = require("./reset-demo-data.js");

resetDemoData()
  .then(() => {
    console.log("Demo data reset complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
