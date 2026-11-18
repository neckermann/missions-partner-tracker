// Same purpose as reset-demo-db-remote.js, against the dev-test Postgres
// on Render instead of the live public demo -- see that script's own
// comment for the full why (a migration squash leaves the live
// database's _prisma_migrations table out of sync with the new squashed
// migration folder on disk, which wedges Render's own preDeployCommand
// with P3018 the moment the new code tries to deploy; resetting here
// first clears that mismatch before the next deploy).
//
// Reuses the exact same DEMO_ADMIN_EMAIL/PASSWORD and optional
// integration env vars from demo/.env as the live-demo script -- the
// dev-test site is a second, pre-prod instance of the same demo-style
// content (full seed data, every feature turned on), not a separate
// identity, so there's no reason for it to need its own admin
// credentials or its own copies of the GroupMe/Postmark/Joshua
// Project/Anthropic keys. Only the database differs, via
// DEV_DEMO_DATABASE_URL instead of DEMO_DATABASE_URL -- both already
// live side by side in demo/.env.
//
// Usage: node scripts/reset-dev-db-remote.js
// Same PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION requirement as
// reset-demo-db-remote.js -- see that script's comment for why this is
// deliberately not hardcoded.
require("dotenv").config({ path: require("path").join(__dirname, "../../demo/.env"), quiet: true });

const devUrl = process.env.DEV_DEMO_DATABASE_URL;
if (!devUrl) {
  console.error("DEV_DEMO_DATABASE_URL not set");
  process.exit(1);
}
process.env.DATABASE_URL = devUrl.includes("sslmode=") ? devUrl : `${devUrl}?sslmode=require`;

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
    console.log("Dev-test database reset complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
