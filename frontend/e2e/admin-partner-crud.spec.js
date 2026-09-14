import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Missionaries and organizations were separate resources with near-identical
// CRUD specs until v2.0.0. They're one Partner resource now, distinguished by
// `kind`, so this covers both through the same form -- which is the point of
// the merge.
test.describe("Admin partner CRUD", () => {
  test("create a missionary with FIPS auto-fill, edit it, then archive and delete", async ({ page }) => {
    await login(page);

    await page.goto("/admin/partners/new?kind=missionary");
    const uniqueName = `E2E Test Missionary ${Date.now()}`;
    await page.getByLabel("Display Name", { exact: true }).fill(uniqueName);

    // Country datalist + FIPS auto-fill (see frontend/src/utils/countryFipsCodes.js) --
    // typing a recognized country into the physical address should fill
    // the FIPS field automatically while it's still blank.
    const physicalCountryInput = page.locator('input[list="physical-country-list"]');
    await physicalCountryInput.fill("Philippines");
    await physicalCountryInput.blur();
    await expect(page.getByLabel("Country Code (FIPS/ISO)")).toHaveValue("RP");

    await page.click('button[type="submit"]:has-text("Save")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);

    const partnerId = page.url().split("/").pop();

    // Edit: confirm the saved FIPS code round-trips back into the form.
    await page.goto(`/admin/partners/${partnerId}/edit`);
    await expect(page.getByLabel("Country Code (FIPS/ISO)")).toHaveValue("RP");
    const updatedName = `${uniqueName} (edited)`;
    await page.getByLabel("Display Name", { exact: true }).fill(updatedName);
    await page.click('button[type="submit"]:has-text("Save")');
    await page.waitForURL(`**/admin/partners/${partnerId}`);
    await expect(page.locator("h2").first()).toHaveText(updatedName);

    // Cleanup via the API directly (same authenticated browser context --
    // Playwright's page.request shares cookies with the page) rather than
    // the UI's native confirm() prompt. Deleting requires archiving first --
    // a deliberate safety rule (see backend/src/routes/partners.js).
    const archived = await page.request.post(`/api/partners/${partnerId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/partners/${partnerId}`);
    expect(del.ok()).toBeTruthy();
  });

  test("create an organization through the same form, then delete it", async ({ page }) => {
    await login(page);

    await page.goto("/admin/partners/new?kind=organization");
    const uniqueName = `E2E Test Org ${Date.now()}`;
    await page.getByLabel("Organization Name").fill(uniqueName);

    const physicalCountryInput = page.locator('input[list="physical-country-list"]');
    await physicalCountryInput.fill("Bolivia");
    await physicalCountryInput.blur();
    await expect(page.getByLabel("Country Code (FIPS/ISO)")).toHaveValue("BL");

    await page.click('button[type="submit"]:has-text("Save")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);

    const partnerId = page.url().split("/").pop();
    const archived = await page.request.post(`/api/partners/${partnerId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/partners/${partnerId}`);
    expect(del.ok()).toBeTruthy();
  });

  test("old missionary and organization URLs redirect to the merged partner page", async ({ page }) => {
    await login(page);

    const res = await page.request.get("/api/partners?kind=missionary");
    const [target] = await res.json();

    await page.goto(`/admin/missionaries/${target.id}`);
    await expect(page).toHaveURL(`/admin/partners/${target.id}`);

    await page.goto(`/admin/organizations/${target.id}`);
    await expect(page).toHaveURL(`/admin/partners/${target.id}`);
  });
});
