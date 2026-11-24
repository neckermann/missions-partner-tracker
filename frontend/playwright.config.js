import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points at wherever the app is already running -- these
// tests never start their own server (see e2e/README.md for why: they
// need a real Postgres-backed backend with a known admin login, which CI
// sets up as separate workflow steps, not something Playwright's
// webServer option can express cleanly here).
const baseURL = process.env.E2E_BASE_URL || "http://localhost:4000";

// Specs that change feature flags or trip settings (see the projects below).
const FEATURE_SPECS = [
  "inbound-email-queue",
  "pending-dispatches",
  "public-subscribe",
  "public-trip-application",
  "trip-detail-subpages",
  "trip-team-table-modal",
].map((name) => new RegExp(`${name}\\.spec\\.js$`));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Tried bumping this to 3-4 (ubuntu-latest has 4 vCPUs) chasing more
  // speed after #162 -- real flakiness both times, empirically verified
  // across several runs: at 4 workers, public-directory-listing specs
  // raced each other (different specs creating/listing partners
  // concurrently); at 3 workers, the TOTP test in auth-boundary.spec.js
  // (inherently timing-sensitive -- it waits for a real 30-second
  // time-step boundary, see that file's own comment) outright failed once,
  // apparently from CPU contention skewing its timing. Not worth it -- a
  // flaky/failing CI run costs far more than the few seconds saved, and in
  // the TOTP case genuinely cost more (one run took 6.2 minutes retrying).
  // 2 stays.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Two projects over the same browser, run one after the other (npm run test:e2e):
  //
  // "parallel" is everything that only reads the church's feature flags, on the workers
  // above. "features" is the specs that CHANGE them (ChurchSettings.enabledFeatures is one
  // shared JSON column, replaced whole by PUT /api/settings, so two specs changing it at once
  // lose each other's updates, and any spec reading a flag mid-change sees it flip). Those run
  // with one worker, after the rest, so a flag is only ever changed while nothing else runs.
  // Playwright has no per-project worker count, hence `--workers=1` on that run (package.json).
  // A spec that starts changing flags belongs in FEATURE_SPECS.
  projects: [
    {
      name: "parallel",
      testIgnore: FEATURE_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "features",
      testMatch: FEATURE_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
