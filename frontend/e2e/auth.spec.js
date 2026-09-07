import { test, expect } from "@playwright/test";
import { login, ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers.js";

test.describe("Admin login", () => {
  test("valid credentials land on the admin dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator(".admin-sidebar")).toBeVisible();
  });

  test("invalid credentials show an error and stay on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', "definitely-the-wrong-password");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("body")).toContainText(/invalid|incorrect|failed/i);
  });

  test("logging out returns to the login page and blocks re-entry to /admin", async ({ page }) => {
    await login(page);
    await page.click("text=Log out");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});
