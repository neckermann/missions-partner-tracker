import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Missionaries and organizations were separate resources with near-identical
// CRUD specs until v2.0.0. They're one Partner resource now, distinguished by
// `kind`, so this covers both through the same flow -- which is the point of
// the merge.
//
// Since v2.0.2 there is no separate edit form: creating asks for the few
// things you can't fill in later, and the partner page edits itself section
// by section.

// Every section on the partner page has its own Edit/Save pair, so a button
// has to be scoped to the section it belongs to.
function section(page, title) {
  return page.locator(".admin-section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test.describe("Admin partner CRUD", () => {
  test("create a missionary with FIPS auto-fill, edit it in place, then archive and delete", async ({ page }) => {
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

    const location = section(page, "Serving Location");
    await expect(location).toContainText("RP");

    // Edit in place: change the name from the Core Info section and confirm
    // it round-trips without leaving the page.
    const core = section(page, "Core Info");
    await core.getByRole("button", { name: "Edit" }).click();
    const updatedName = `${uniqueName} (edited)`;
    await core.getByLabel("Display Name", { exact: true }).fill(updatedName);
    await core.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("h2").first()).toHaveText(updatedName);

    // Editing one section must not disturb another: the physical address is
    // replaced wholesale on the server, so a Core Info save that carried a
    // stale address payload would show up here.
    await expect(section(page, "Serving Location")).toContainText("RP");

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
    await expect(section(page, "Serving Location")).toContainText("BL");

    // The org has no Family or Languages sections -- those are
    // missionary-only, and the merged page hides them by kind rather than
    // rendering empty boxes.
    await expect(page.getByRole("heading", { name: "Family", exact: true })).toHaveCount(0);

    const partnerId = page.url().split("/").pop();
    const archived = await page.request.post(`/api/partners/${partnerId}/archive`);
    expect(archived.ok()).toBeTruthy();
    const del = await page.request.delete(`/api/partners/${partnerId}`);
    expect(del.ok()).toBeTruthy();
  });

  test("old missionary, organization and /edit URLs redirect to the merged partner page", async ({ page }) => {
    await login(page);

    const res = await page.request.get("/api/partners?kind=missionary");
    const [target] = await res.json();

    await page.goto(`/admin/missionaries/${target.id}`);
    await expect(page).toHaveURL(`/admin/partners/${target.id}`);

    await page.goto(`/admin/organizations/${target.id}`);
    await expect(page).toHaveURL(`/admin/partners/${target.id}`);

    await page.goto(`/admin/partners/${target.id}/edit`);
    await expect(page).toHaveURL(`/admin/partners/${target.id}`);
  });
});
