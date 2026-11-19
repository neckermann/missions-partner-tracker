import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test("trip detail sub-pages render without errors", async ({ page }) => {
  await login(page);
  await page.goto("/admin/trips");
  await page.waitForSelector(".admin-table");
  await page.locator(".admin-table tbody tr").first().locator("td").nth(4).click();
  await page.waitForURL(/\/admin\/trips\/[^/]+$/);
  console.log("TRIP URL", page.url());
  await expect(page.getByText("Trip setup")).toBeVisible();
  for (const tab of ["Team", "Meetings", "Requirements", "Flights"]) {
    await page.getByRole("link", { name: new RegExp("^" + tab) }).click();
    await expect(page.locator("body")).not.toContainText(
      /cannot read|undefined is not|something went wrong/i
    );
  }

  // A participant's own detail page, reached from the Team tab -- the
  // other half of this phase's onBlur -> EditableSection migration.
  await page.getByRole("link", { name: /^Team/ }).click();
  const viewDetails = page.getByRole("link", { name: "View details" }).first();
  if (await viewDetails.count()) {
    await viewDetails.click();
    await expect(page.getByText("Contact & access")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /cannot read|undefined is not|something went wrong/i
    );
  }
});
