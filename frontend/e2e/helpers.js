// Shared helpers for the e2e suite. Credentials come from env vars rather
// than being hardcoded, so CI can point this at a throwaway account
// created fresh for that run (see .github/workflows/backend-deploy-aws.yml)
// while local runs can point at whatever admin account exists in the
// developer's own local database.
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";

export async function login(page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/);
}
