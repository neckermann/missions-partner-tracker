import { test, expect } from "@playwright/test";
import { login, firstSelectablePartner } from "./helpers.js";

test.describe("Monthly Support", () => {
  test("add a support entry, confirm it becomes current, then delete it from the History panel", async ({
    page,
  }) => {
    await login(page);

    // Must be one the Add form's partner dropdown will actually list --
    // see firstSelectablePartner.
    const target = await firstSelectablePartner(page);

    await page.goto("/admin/support/monthly");
    await page.waitForSelector("h2:has-text('Monthly Support')");

    const uniqueNotes = `E2E entry ${Date.now()}`;

    await page.click("button:has-text('+ Add Support Entry')");
    await page.getByLabel("Partner").selectOption({ label: target.displayName });
    await page.getByLabel("Monthly Amount (USD)").fill("777");
    // Yesterday: the latest entry already in force (== "current") regardless of whatever else is on file. A date in
    // the future would not do, because an amount that has not started yet is not the current one.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel("Effective Date").fill(yesterday);
    await page.getByLabel("Notes").fill(uniqueNotes);
    await page.click('button[type="submit"]:has-text("Save Entry")');

    // By id, not display name -- the seed's random names can collide as
    // substrings (e.g. "Amanda Kavanagh" inside "Frank and Amanda
    // Kavanagh"), which `hasText` would otherwise match ambiguously.
    const row = page.locator(`tr[data-partner-id="${target.id}"]`);
    await expect(row).toContainText("$777");

    // Deleting a mis-entered support entry through the History panel is the feature under test
    // (unlike the other CRUD specs, which clean up via the API).
    await row.getByRole("button", { name: /^History/ }).click();

    // The expanded History panel is the very next <tr> sibling, containing
    // its own nested table -- scope to its <tbody> specifically, since a
    // plain `tr` + hasText match would also match that whole wrapping row
    // (it contains the same text via its nested table).
    const historyPanel = row.locator("xpath=following-sibling::tr[1]");
    const historyRow = historyPanel.locator("tbody tr", { hasText: uniqueNotes });
    await expect(historyRow).toBeVisible();
    await historyRow.getByRole("button", { name: "Delete" }).click();
    // Opens a styled confirm dialog (useConfirmDialog.jsx), not a native confirm(); scope to the
    // dialog role because the row's own trigger button has the same name.
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(historyPanel.locator("tbody tr", { hasText: uniqueNotes })).toHaveCount(0);
  });
});
