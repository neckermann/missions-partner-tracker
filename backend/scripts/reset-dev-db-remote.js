// Same as reset-demo-db-remote.js (see its comment for why a reset is needed after a migration
// squash), against the dev-test Postgres on Render instead of the live demo.
//
// Reuses the DEMO_ADMIN_EMAIL/PASSWORD and optional integration env vars from demo/.env:
// dev-test is a second, pre-prod instance of the same demo content, so it needs no separate
// credentials or keys. Only the database differs, via DEV_DEMO_DATABASE_URL instead of
// DEMO_DATABASE_URL.
//
// Usage: node scripts/reset-dev-db-remote.js
// Needs the same PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION as reset-demo-db-remote.js.
require("dotenv").config({ path: require("path").join(__dirname, "../../demo/.env"), quiet: true });

// dev-test is the owner's own test deployment: it keeps the real keys on purpose (utils/demoMode.js).
process.env.DEMO_RESET_TOKEN = process.env.DEMO_RESET_TOKEN || "remote-reset";
process.env.DEMO_TESTING_SITE = "true";

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
