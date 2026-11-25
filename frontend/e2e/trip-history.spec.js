import { test, expect } from "@playwright/test";
import { login, firstSelectablePartner } from "./helpers.js";

test.describe("Trip History", () => {
  test("add a trip with a participant, edit it, and confirm it appears in the consolidated list", async ({
    page,
  }) => {
    await login(page);

    // Must be one the Add form's partner dropdown will actually list --
    // see firstSelectablePartner.
    const target = await firstSelectablePartner(page);

    await page.goto("/admin/trips");
    await page.waitForSelector("h2:has-text('Trips')");

    const uniqueDescription = `E2E trip ${Date.now()}`;
    // The table has no Description column (it only shows in the Add/Edit forms), so a row can't be
    // located by it. 1901 is the same "a year nothing real uses" convention
    // backend/test/routes/trips.test.js relies on; tagging this trip with it and filtering the
    // Year select to it makes the row unique regardless of other seed data.
    const uniqueStartDate = "1901-06-15";

    // Scoped to the Add form -- the Filters section above it has its own
    // "Trip Type" select, and getByLabel would otherwise match both.
    const addForm = page.locator("form");
    await page.click("button:has-text('+ New Trip')");
    // "Start recruiting a new trip" is the default choice; this test logs
    // a trip that already happened, which is the second radio.
    await page.getByLabel("Log a trip that already happened").check();
    await addForm.getByLabel("Partner").selectOption({ label: target.displayName });
    await addForm.getByLabel("Start Date").fill(uniqueStartDate);
    await addForm.getByLabel("Trip Type").selectOption("Construction");
    await addForm.getByLabel("Description (what the team did)").fill(uniqueDescription);
    await addForm.getByRole("button", { name: "+ Add Participant" }).click();
    // Participants have separate First/Last Name fields; lastName is required.
    await addForm.getByLabel("First Name").fill("E2E");
    await addForm.getByLabel("Last Name").fill("Participant");
    await page.click('button[type="submit"]:has-text("Save Trip")');

    // The Trips page's default quick filter is "Active (not completed)" --
    // a trip logged via "Log a trip that already happened" saves as
    // completed, so it's hidden from the list until switching to "All
    // statuses". The Year select's options are generated from whatever
    // years already exist in the loaded trips, so "1901" only appears
    // once this trip has saved and the list has reloaded with it.
    await page.getByRole("button", { name: "All statuses" }).click();
    // "Year" isn't shown by default -- FilterBar hides any field whose
    // value is still its default behind "+ Add filter" until picked. Its
    // active-chip <select> has no real label association (a plain
    // adjacent <span>, not a <label>/aria-label on the control itself),
    // so it has to be found by scoping to the chip rather than by label.
    await page.getByRole("button", { name: "+ Add filter" }).click();
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await page.locator(".filter-chip", { hasText: "Year:" }).locator("select").selectOption("1901");

    const row = page.locator("tbody tr", { hasText: target.displayName });
    // The list has no Trip Type column; the type is confirmed on the saved record below.
    await expect(row).toContainText("1"); // team size

    // Edit: a completed trip's row is itself the click target; click a cell outside the Partner
    // column (stopRowClick: it's its own link). The table never displays description, so the
    // round-trip is confirmed against the API.
    const updatedDescription = `${uniqueDescription} (edited)`;
    await row.locator("td").nth(4).click();
    await page.getByLabel("Description (what the team did)").fill(updatedDescription);
    await page.click('button:has-text("Save")');

    // The "Save" click's own async work (PUT then reload()) isn't awaited
    // by the click itself, and reload()'s two list fetches race the click
    // handler's return, so poll briefly rather than trusting a single read.
    let created;
    await expect
      .poll(async () => {
        const refreshed = await page.request.get(`/api/trips?partnerId=${target.id}`);
        const trips = await refreshed.json();
        created = trips.find((t) => t.description === updatedDescription);
        return Boolean(created);
      })
      .toBeTruthy();
    expect(created.type).toBe("Construction");

    // Clean up via the API (page.request shares the page's cookies), not the native confirm()
    // delete prompt.
    const del = await page.request.delete(`/api/trips/${created.id}`);
    expect(del.ok()).toBeTruthy();
  });

  // A Google Photos/iCloud/Other link to an album the admin maintains elsewhere, never in-app
  // file storage. Covers the happy path and the invalid-link rejection, the latter because the
  // rejection hint once shifted the Save button just as a click landed on it.
  test("photo/video album link: a valid link round-trips, an invalid one is rejected without saving", async ({
    page,
  }) => {
    await login(page);
    const target = await firstSelectablePartner(page);

    await page.goto("/admin/trips");
    await page.waitForSelector("h2:has-text('Trips')");

    const addForm = page.locator("form");
    await page.click("button:has-text('+ New Trip')");
    await page.getByLabel("Log a trip that already happened").check();
    await addForm.getByLabel("Partner").selectOption({ label: target.displayName });

    const albumField = addForm.locator("label", { hasText: "Photo/Video Album" });
    await albumField.locator("select").selectOption("google_photos");
    await albumField.locator("input").fill("https://example.com/not-a-real-photos-link");
    await addForm.getByRole("button", { name: "Save Trip" }).click();
    await expect(page.getByText(/Enter a valid album link/i)).toBeVisible();

    await albumField.locator("input").fill("https://photos.app.goo.gl/e2eTestAlbum");
    await addForm.getByRole("button", { name: "Save Trip" }).click();

    // The table's "View" link points to the trip's detail page, not the album URL, so the
    // round-trip is confirmed directly against the API.
    let created;
    await expect
      .poll(async () => {
        const refreshed = await page.request.get(`/api/trips?partnerId=${target.id}`);
        const trips = await refreshed.json();
        created = trips.find((t) => t.albumUrl === "https://photos.app.goo.gl/e2eTestAlbum");
        return Boolean(created);
      })
      .toBeTruthy();
    expect(created.albumProvider).toBe("google_photos");

    const del = await page.request.delete(`/api/trips/${created.id}`);
    expect(del.ok()).toBeTruthy();
  });
});
