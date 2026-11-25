import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// publicPrayerDigest defaults off, and POST /api/public/subscribe also needs outboundEmail
// configured (see backend/test/routes/publicSubscribe.test.js's setup), so both are turned on
// before any test here touches /subscribe and put back after. beforeAll/afterAll run once per
// worker, so the file is forced serial.
//
// Feature flags are one shared column that PUT /api/settings replaces whole, so this file is
// one of the six that change them; they run together in their own serial Playwright project
// (playwright.config.js). setFeatures/restoreFeatures (helpers.js) merge and restore.
let previousFeatures;

test.describe.configure({ mode: "serial" });
test.describe("Public subscribe page", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    // /api/settings/email is gated on outboundEmail already being on (by design), so outboundEmail
    // is turned on via the generic settings PUT first, as in
    // backend/test/routes/publicSubscribe.test.js.
    previousFeatures = await setFeatures(page.request, { publicPrayerDigest: true, outboundEmail: true });
    await page.request.put("/api/settings/email", {
      data: { sendEnabled: true, serverToken: "e2e-test-token", fromAddress: "updates@example.test" },
    });
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await restoreFeatures(page.request, previousFeatures);
    await context.close();
  });

  test("renders with 'Include all partners' checked and no checklist visible", async ({ page }) => {
    await page.goto("/subscribe");
    const allCheckbox = page
      .locator(".admin-checkbox-row", { hasText: "Include all partners" })
      .locator('input[type="checkbox"]');
    await expect(allCheckbox).toBeChecked();
    await expect(page.locator(".admin-checkbox-row")).toHaveCount(1);
  });

  test("unchecking 'Include all partners' reveals a partner checklist", async ({ page }) => {
    await page.goto("/subscribe");
    const allCheckbox = page
      .locator(".admin-checkbox-row", { hasText: "Include all partners" })
      .locator('input[type="checkbox"]');
    await allCheckbox.uncheck();
    // At least 2 (the "all partners" row plus one real partner) --
    // exact count depends on local seed data, which varies by environment.
    await expect(page.locator(".admin-checkbox-row")).not.toHaveCount(1, { timeout: 10000 });
  });

  test("picking a partner and submitting a valid email succeeds", async ({ page }) => {
    await page.goto("/subscribe");
    const allCheckbox = page
      .locator(".admin-checkbox-row", { hasText: "Include all partners" })
      .locator('input[type="checkbox"]');
    await allCheckbox.uncheck();
    await page.locator(".admin-checkbox-row input[type='checkbox']").nth(1).check();
    await page.getByPlaceholder("you@example.com").fill(`e2e-subscribe-${Date.now()}@example.test`);
    await page.click('button:has-text("Subscribe")');
    await expect(page.locator(".public-subscribe-success")).toBeVisible({ timeout: 10000 });
  });

  test("submitting with nothing selected shows a validation error, no API call", async ({ page }) => {
    await page.goto("/subscribe");
    const allCheckbox = page
      .locator(".admin-checkbox-row", { hasText: "Include all partners" })
      .locator('input[type="checkbox"]');
    await allCheckbox.uncheck();
    await page.getByPlaceholder("you@example.com").fill(`e2e-subscribe-empty-${Date.now()}@example.test`);
    await page.click('button:has-text("Subscribe")');
    await expect(page.locator(".form-error")).toContainText(/choose at least one partner/i);
  });

  test("the directory and partner-detail nav links point to /subscribe", async ({ page }) => {
    await page.goto("/");
    const directoryLink = page.locator('a[href="/subscribe"]', { hasText: /^Pray for our/ });
    await expect(directoryLink).toBeVisible();

    const partnersRes = await page.request.get("/api/public/partners");
    const partners = await partnersRes.json();
    expect(partners.length).toBeGreaterThan(0);
    await page.goto(`/partners/${partners[0].id}`);
    const detailLink = page.locator('a[href="/subscribe"]', { hasText: /^Pray for our/ });
    await expect(detailLink).toBeVisible();
  });
});
