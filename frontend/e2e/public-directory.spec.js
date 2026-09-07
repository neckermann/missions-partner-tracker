import { test, expect } from "@playwright/test";

test.describe("Public directory", () => {
  test("loads and lists partners", async ({ page }) => {
    await page.goto("/");
    // At least one partner card should render -- exact count depends on
    // whatever data is loaded (seed data locally, a handful in CI), so
    // this checks presence, not a specific number.
    await expect(page.locator(".partner-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("search filters the list", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".partner-card", { timeout: 10000 });
    const before = await page.locator(".partner-card").count();

    await page.getByPlaceholder(/Search by name, region, focus/i).fill("zzzznonexistentpartnernamezzzz");
    await page.waitForTimeout(400);
    const after = await page.locator(".partner-card").count();

    expect(after).toBeLessThan(before || 1);
  });
});

test.describe("Public map", () => {
  test("renders with a non-zero-height map container and loads tiles", async ({ page }) => {
    await page.goto("/map");
    const map = page.locator(".leaflet-container").first();
    await expect(map).toBeVisible({ timeout: 10000 });

    const box = await map.boundingBox();
    expect(box?.height).toBeGreaterThan(50);

    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 10000 });
  });

  test("renders correctly at a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map");
    const map = page.locator(".leaflet-container").first();
    await expect(map).toBeVisible({ timeout: 10000 });
    const box = await map.boundingBox();
    expect(box?.height).toBeGreaterThan(50);
  });
});
