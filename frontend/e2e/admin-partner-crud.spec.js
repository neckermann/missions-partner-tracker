import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Missionaries and organizations are one Partner record distinguished by `kind`, so both go
// through the same flow. There is no separate edit form: creating asks for what can't be
// filled in later, and the partner page edits itself section by section.

// Every section on the partner page is itself the click target (EditableSection.jsx), so a
// section is located by its heading, not by an Edit button inside it.
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

    // Country datalist + FIPS auto-fill (utils/countryFipsCodes.js): the create form derives the
    // code from a recognized country name.
    await page.getByPlaceholder("Start typing a country...").fill("Philippines");

    // New Partner is a 3-step Wizard (Basics / Details / Visibility & status); neither later step
    // has anything required here.
    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Finish")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);

    const partnerId = page.url().split("/").pop();

    // The FIPS field only shows when Joshua Project is on (off by default here), so the auto-fill
    // is checked via the API.
    const afterCreate = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(afterCreate.fipsCountryCode).toBe("RP");

    const location = section(page, "Serving Location");
    await expect(location).toContainText("Philippines");

    // Edit in place: change the name from the Status & Visibility section and confirm it
    // round-trips without leaving the page. The whole card is the click target (see `section()`
    // above).
    const status = section(page, "Status & Visibility");
    await status.click();
    const updatedName = `${uniqueName} (edited)`;
    await page.locator(".modal-panel").getByLabel("Display Name", { exact: true }).fill(updatedName);
    await page.locator(".modal-panel button", { hasText: "Save" }).click();
    await expect(page.locator(".modal-panel")).toHaveCount(0);
    await expect(page.locator("h2").first()).toHaveText(updatedName);

    // Editing one section must not disturb another: the physical address is
    // replaced wholesale on the server, so a Mailing & Contact Address save
    // that carried a stale physical-address payload would show up here.
    await expect(section(page, "Serving Location")).toContainText("Philippines");
    const afterEdit = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(afterEdit.fipsCountryCode).toBe("RP");

    // Clean up via the API (page.request shares the page's cookies), not the native confirm()
    // prompt. Deleting requires archiving first, a deliberate safety rule (routes/partners.js).
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
    await page.getByPlaceholder("Start typing a country...").fill("Bolivia");

    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Finish")');
    await page.waitForURL(/\/admin\/partners\/[a-zA-Z0-9-]+$/);
    await expect(page.locator("h2").first()).toHaveText(uniqueName);
    await expect(section(page, "Serving Location")).toContainText("Bolivia");

    const partnerId = page.url().split("/").pop();
    // The FIPS field only shows when Joshua Project is on (off by default here), so the auto-fill
    // is checked via the API.
    const created = await (await page.request.get(`/api/partners/${partnerId}`)).json();
    expect(created.fipsCountryCode).toBe("BL");

    // The org has no Wedding Anniversary/Adults/Children/Languages sections: those are
    // missionary-only and hidden by kind.
    for (const heading of ["Wedding Anniversary", "Adults", "Children", "Languages Spoken"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
    }

    const archived = await page.request.post(`/api/partners/${partnerId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/partners/${partnerId}`);
    expect(del.ok()).toBeTruthy();
  });
});
