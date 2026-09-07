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
