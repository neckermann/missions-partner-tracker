// Runs scripts/reset-demo-data.js's resetDemoData() against the LIVE demo
// Postgres on Render, from a local machine, instead of running it as a
// one-off command on the Render service itself. Needed specifically after
// a migration squash: a squash replaces the migration folder(s) on disk
// with a new name/content that the live demo's own _prisma_migrations
// table has no record of, so Render's own `preDeployCommand` (`prisma
// migrate deploy`) fails with P3018 ("relation already exists") the
// moment the new code tries to deploy -- deploy and migration are coupled
// there, so there's no way to fix it from Render's own pipeline once it's
// already wedged. Running the reset here first (which does a real
// `migrate reset --force`, dropping and recreating from the new squashed
// migration) clears that mismatch, so the *next* deploy's `migrate
// deploy` finds the migration already applied and no-ops through it.
//
// Two things this needs that `npm run demo:reset` (same script, run via
// a Render shell or the admin's own reset route) doesn't:
//
// 1. DEMO_DATABASE_URL, not DATABASE_URL -- this repo's own .env has no
//    bare DATABASE_URL at all (Render injects that directly on the
//    service; there's nothing to point it at locally), so this script
//    remaps DEMO_DATABASE_URL into DATABASE_URL before requiring
//    reset-demo-data.js, which reads it via prismaClient.js as usual.
//
// 2. `?sslmode=require` appended to that URL. prismaClient.js's own
//    parseDatabaseUrl() only turns TLS on when the connection string's
//    sslmode query param is literally "require" -- a bare Render
//    external connection string has no query string at all, so without
//    this the @prisma/adapter-pg path connects with no TLS and fails
//    with P1017 ConnectionClosed on every real query (migrate's own CLI
//    connection logic tolerates the bare string fine, which is why this
//    is easy to miss -- `migrate reset` succeeds, then the very next
//    step, createAdmin.js's own prisma.user.upsert, fails).
//
// Usage: node scripts/reset-demo-db-remote.js
// Requires the same env vars reset-demo-data.js itself needs
// (DEMO_ADMIN_EMAIL/PASSWORD, GROUPME_*/POSTMARK_*/etc. for restoring
// integrations) -- these live in demo/.env at the repo root (gitignored,
// real secrets), not backend/.env (this app's own generic local-dev
// config), since they're specific to operating the one live demo
// instance, not to running this app at all. Loaded explicitly below by
// path rather than relying on dotenv's cwd-relative default, so this
// works the same regardless of where it's invoked from.
//
// Prisma's own AI-agent safety guard additionally requires
// PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION to be set, to the exact
// verbatim text of the user's own most recent message consenting to this
// specific destructive action against this specific database -- that is
// deliberately NOT hardcoded here (a script that supplied its own
// canned consent would defeat the point of the guard); set it in the
// shell invocation each time this is actually run, e.g.:
//
//   PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<their message>" node scripts/reset-demo-db-remote.js
//
// Keep this script around (not a *.tmp.* throwaway) until 1.0.0 ships --
// the demo's migration history still gets squashed on every schema
// change until then (see the "pre-1.0 migration squashing" convention),
// and this is the fastest way to recover the live demo DB each time.
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
