import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Monthly Support", () => {
  test("add a support entry, confirm it becomes current, then delete it from the History panel", async ({ page }) => {
    await login(page);

    const missionariesRes = await page.request.get("/api/missionaries");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    await page.goto("/admin/support/monthly");
    await page.waitForSelector("h2:has-text('Monthly Support')");

    const uniqueNotes = `E2E entry ${Date.now()}`;

    await page.click("button:has-text('+ Add Support Entry')");
    await page.getByLabel("Missionary or Organization").selectOption({ label: target.displayName });
    await page.getByLabel("Monthly Amount (USD)").fill("777");
    // Far in the future so this entry is unambiguously the latest
    // effectiveDate (== "current") regardless of whatever else is on file.
    await page.getByLabel("Effective Date").fill("2099-01-01");
    await page.getByLabel("Notes").fill(uniqueNotes);
    await page.click('button[type="submit"]:has-text("Save Entry")');

    const row = page.locator("tr", { hasText: target.displayName }).first();
    await expect(row).toContainText("$777");

    // Auto-dismiss the native confirm() prompt the Delete button inside
    // History triggers -- exercised here (unlike the other CRUD specs'
    // API-cleanup approach) since deleting a mis-entered support entry
    // through the History panel is the actual feature being tested.
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: /^History/ }).click();

    // The expanded History panel is the very next <tr> sibling, containing
    // its own nested table -- scope to its <tbody> specifically, since a
    // plain `tr` + hasText match would also match that whole wrapping row
    // (it contains the same text via its nested table).
    const historyPanel = row.locator("xpath=following-sibling::tr[1]");
    const historyRow = historyPanel.locator("tbody tr", { hasText: uniqueNotes });
    await expect(historyRow).toBeVisible();
    await historyRow.getByRole("button", { name: "Delete" }).click();
    await expect(historyPanel.locator("tbody tr", { hasText: uniqueNotes })).toHaveCount(0);
  });
});
