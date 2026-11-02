import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Missionaries and organizations are one Partner record distinguished by
// `kind`, so both go through the same flow here.
//
// There is no separate edit form: creating asks for the few things you can't
// fill in later, and the partner page edits itself section by section.

// Every section on the partner page has its own Edit/Save pair, so a button
// has to be scoped to the section it belongs to.
function section(page, title) {
  return page
    .locator(".admin-section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test.describe("Admin partner CRUD", () => {
  test("create a missionary with FIPS auto-fill, edit it in place, then archive and delete", async ({
    page,
  }) => {
    await login(page);

    await page.goto("/admin/partners/new?kind=missionary");
    const uniqueName = `E2E Test Missionary ${Date.now()}`;
    await page.getByLabel("Display Name", { exact: true }).fill(uniqueName);

    // Country datalist + FIPS auto-fill (see frontend/src/utils/countryFipsCodes.js) --
    // the create form derives the code from a recognized country name rather
    // than asking for it.
    await page.locator('input[list="new-partner-country-list"]').fill("Philippines");

    await page.click('button[type="submit"]:has-text("Create Partner")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);

    const partnerId = page.url().split("/").pop();

    // The FIPS field itself only shows when Joshua Project is on (off by
    // default here), so the auto-fill is checked via the API rather than
    // the UI -- it still runs in the background regardless of visibility.
    const afterCreate = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(afterCreate.fipsCountryCode).toBe("RP");

    const location = section(page, "Serving Location");
    await expect(location).toContainText("Philippines");

    // Edit in place: change the name from the Mailing & Contact Address
    // section (Display Name lives there now) and confirm it round-trips
    // without leaving the page.
    const mailing = section(page, "Mailing & Contact Address");
    await mailing.getByRole("button", { name: "Edit" }).click();
    const updatedName = `${uniqueName} (edited)`;
    await mailing.getByLabel("Display Name", { exact: true }).fill(updatedName);
    await mailing.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("h2").first()).toHaveText(updatedName);

    // Editing one section must not disturb another: the physical address is
    // replaced wholesale on the server, so a Mailing & Contact Address save
    // that carried a stale physical-address payload would show up here.
    await expect(section(page, "Serving Location")).toContainText("Philippines");
    const afterEdit = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(afterEdit.fipsCountryCode).toBe("RP");

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
    await page.locator('input[list="new-partner-country-list"]').fill("Bolivia");

    await page.click('button[type="submit"]:has-text("Create Partner")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);
    await expect(section(page, "Serving Location")).toContainText("Bolivia");

    const partnerId = page.url().split("/").pop();
    // The FIPS field itself only shows when Joshua Project is on (off by
    // default here), so the auto-fill is checked via the API rather than
    // the UI -- it still runs in the background regardless of visibility.
    const created = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(created.fipsCountryCode).toBe("BL");

    // The org has no Family or Languages sections -- those are
    // missionary-only, and the merged page hides them by kind rather than
    // rendering empty boxes.
    await expect(page.getByRole("heading", { name: "Family", exact: true })).toHaveCount(0);

    const archived = await page.request.post(`/api/partners/${partnerId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/partners/${partnerId}`);
    expect(del.ok()).toBeTruthy();
  });
});
