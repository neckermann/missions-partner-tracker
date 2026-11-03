import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points at wherever the app is already running -- these
// tests never start their own server (see e2e/README.md for why: they
// need a real Postgres-backed backend with a known admin login, which CI
// sets up as separate workflow steps, not something Playwright's
// webServer option can express cleanly here).
const baseURL = process.env.E2E_BASE_URL || "http://localhost:4000";

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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
