import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Trip History", () => {
  test("add a trip with a participant, edit it, and confirm it appears in the consolidated list", async ({ page }) => {
    await login(page);

    const missionariesRes = await page.request.get("/api/missionaries");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    await page.goto("/admin/trips");
    await page.waitForSelector("h2:has-text('Trip History')");

    const uniqueDescription = `E2E trip ${Date.now()}`;

    // Scoped to the Add form -- the Filters section above it has its own
    // "Trip Type" select, and getByLabel would otherwise match both.
    const addForm = page.locator("form");
    await page.click("button:has-text('+ Add Trip')");
    await addForm.getByLabel("Missionary or Organization").selectOption({ label: target.displayName });
    await addForm.getByLabel("Trip Type").selectOption("Construction");
    await addForm.getByLabel("Description (what the team did)").fill(uniqueDescription);
    await addForm.getByRole("button", { name: "+ Add Participant" }).click();
    await addForm.getByLabel("Name").fill("E2E Participant");
    await page.click('button[type="submit"]:has-text("Save Trip")');

    const row = page.locator("tr", { hasText: uniqueDescription });
    await expect(row).toContainText(target.displayName);
    await expect(row).toContainText("Construction");
    await expect(row).toContainText("1"); // team size

    // Edit: change the description and confirm it round-trips.
    const updatedDescription = `${uniqueDescription} (edited)`;
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Description (what the team did)").fill(updatedDescription);
    await page.click('button:has-text("Save")');
    await expect(page.locator("tr", { hasText: updatedDescription })).toBeVisible();

    // Cleanup via the API directly (same authenticated browser context --
    // Playwright's page.request shares cookies with the page), matching
    // admin-missionary-crud.spec.js's approach rather than driving the
    // native confirm() delete prompt through the UI.
    // The "Save" click's own async work (PUT then reload()) isn't awaited
    // by the click itself, and reload()'s two list fetches race the
    // click handler's return -- the on-screen assertion above already
    // waited for the UI to catch up, but a fresh page.request.get() here
    // can still land a beat before the write is visible, so poll briefly
    // rather than trusting a single read.
    let created;
    await expect
      .poll(async () => {
        const refreshed = await page.request.get(`/api/missionaries/${target.id}`);
        const { missionTrips } = await refreshed.json();
        created = missionTrips.find((t) => t.description === updatedDescription);
        return Boolean(created);
      })
      .toBeTruthy();
    const del = await page.request.delete(`/api/trips/${created.id}`);
    expect(del.ok()).toBeTruthy();
  });
});
