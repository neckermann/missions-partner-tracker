import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Admin missionary CRUD", () => {
  test("create, verify country/FIPS auto-fill, edit, and delete", async ({ page }) => {
    await login(page);

    await page.goto("/admin/missionaries/new");
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
    await page.waitForURL(/\/admin\/missionaries\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2")).toHaveText(uniqueName);

    const detailUrl = page.url();
    const missionaryId = detailUrl.split("/").pop();

    // Edit: confirm the saved FIPS code round-trips back into the form.
    await page.goto(`/admin/missionaries/${missionaryId}/edit`);
    await expect(page.getByLabel("Country Code (FIPS/ISO)")).toHaveValue("RP");
    const updatedName = `${uniqueName} (edited)`;
    await page.getByLabel("Display Name", { exact: true }).fill(updatedName);
    await page.click('button[type="submit"]:has-text("Save")');
    await page.waitForURL(`**/admin/missionaries/${missionaryId}`);
    await expect(page.locator("h2")).toHaveText(updatedName);

    // Cleanup via the API directly (same authenticated browser context --
    // Playwright's page.request shares cookies with the page) rather than
    // the UI's native confirm() prompt, which is awkward to drive
    // reliably and isn't the thing this test is meant to cover. Deleting
    // requires archiving first -- a deliberate safety rule (see
    // backend/src/routes/missionaries.js) against accidental permanent
    // deletion.
    const archived = await page.request.post(`/api/missionaries/${missionaryId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/missionaries/${missionaryId}`);
    expect(del.ok()).toBeTruthy();
  });
});
