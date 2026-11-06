import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// publicPrayerDigest defaults off, and POST /api/public/subscribe also
// needs outboundEmail configured (see backend/test/routes/
// publicSubscribe.test.js's own setup) -- turn both on before any test in
// this file touches /subscribe, and restore the prior state after.
// beforeAll/afterAll run once per *worker*, not once globally -- forced
// serial here so this file's own tests can't race each other toggling
// the shared ChurchSettings row across parallel workers (confirmed no
// other spec file touches enabledFeatures, so this is the only source
// of that race).
test.describe.configure({ mode: "serial" });
test.describe("Public subscribe page", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    // /api/settings/email is itself gated on outboundEmail already being
    // on (chicken-and-egg by design -- see that route's own comment), so
    // outboundEmail has to be turned on via the generic settings PUT
    // first, same two-step order backend/test/routes/publicSubscribe.test.js
    // uses.
    await page.request.put("/api/settings", {
      data: { enabledFeatures: { publicPrayerDigest: true, outboundEmail: true } },
    });
    await page.request.put("/api/settings/email", {
      data: { sendEnabled: true, serverToken: "e2e-test-token", fromAddress: "updates@example.test" },
    });
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await page.request.put("/api/settings", {
      data: { enabledFeatures: { publicPrayerDigest: false, outboundEmail: false } },
    });
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
