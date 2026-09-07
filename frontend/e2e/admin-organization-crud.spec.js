import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Admin organization CRUD", () => {
  test("create with a physical address and FIPS auto-fill, then delete", async ({ page }) => {
    await login(page);

    await page.goto("/admin/organizations/new");
    const uniqueName = `E2E Test Org ${Date.now()}`;
    await page.getByLabel("Organization Name").fill(uniqueName);

    const physicalCountryInput = page.locator('input[list="physical-country-list"]');
    await physicalCountryInput.fill("Bolivia");
    await physicalCountryInput.blur();
    await expect(page.getByLabel("Country Code (FIPS/ISO)")).toHaveValue("BL");

    await page.click('button[type="submit"]:has-text("Save")');
    await page.waitForURL(/\/admin\/organizations\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2")).toHaveText(uniqueName);

    // Cleanup via the API directly (same authenticated browser context --
    // Playwright's page.request shares cookies with the page). Deleting
    // requires archiving first -- a deliberate safety rule (see
    // backend/src/routes/organizations.js) against accidental permanent
    // deletion.
    const orgId = page.url().split("/").pop();
    const archived = await page.request.post(`/api/organizations/${orgId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/organizations/${orgId}`);
    expect(del.ok()).toBeTruthy();
  });
});
