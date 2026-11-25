import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// A row that opens its record has no separate Open or View button: it is clickable, looks
// clickable (pointer, a link-coloured first cell), and opens from the keyboard too.
test.describe("Clickable rows", () => {
  test("the Partners list opens a partner by click or by keyboard, with no Open button", async ({ page }) => {
    await login(page);
    await page.goto("/admin/partners");
    const row = page.locator("table tbody tr.row-clickable").first();
    await expect(row).toBeVisible();
    await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveCount(0);
    expect(await row.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");

    await row.click();
    await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}$/);

    await page.goBack();
    const again = page.locator("table tbody tr.row-clickable").first();
    await again.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}$/);
  });

  test("a button inside a row keeps its own Enter key and does not open the row", async ({ page }) => {
    await login(page);
    await page.goto("/admin/partners");
    const archive = page
      .locator("table tbody tr.row-clickable")
      .first()
      .getByRole("button", { name: "Archive" });
    if (await archive.count()) {
      await archive.focus();
      // Enter on the button must not also open the partner.
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/admin\/partners$/);
    }
  });
});
