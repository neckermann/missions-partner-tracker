import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Existing Trips / Plan a Trip are real tabs now (URL-backed), not just
// local state switching which content renders -- regression coverage for
// the exact bug this fixed: refreshing or landing directly on either
// tab's own URL must show that tab, and clicking a tab must update the
// URL, in both directions.
test.describe("Trips tabs", () => {
  test("clicking a tab updates the URL, and loading either URL directly lands on the right tab", async ({
    page,
  }) => {
    await login(page);

    await page.goto("/admin/trips");
    await expect(page.getByRole("tab", { name: "Existing Trips" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.getByRole("tab", { name: "Plan a Trip" }).click();
    await expect(page).toHaveURL(/\/admin\/trips\/planning$/);
    await expect(page.getByRole("tab", { name: "Plan a Trip" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // A fresh load of the Plan-a-Trip URL (simulating a refresh or a
    // shared link) must land on that tab directly, not default back to
    // Existing Trips.
    await page.goto("/admin/trips/planning");
    await expect(page.getByRole("tab", { name: "Plan a Trip" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.getByRole("tab", { name: "Existing Trips" }).click();
    await expect(page).toHaveURL(/\/admin\/trips$/);
    await expect(page.getByRole("tab", { name: "Existing Trips" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});
