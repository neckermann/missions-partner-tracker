import { test, expect } from "@playwright/test";
import { login, layoutProblems, setFeatures, restoreFeatures } from "./helpers.js";

// The public site's header nav (Directory, Map, Pray for our Missionaries, Trip Opportunities)
// ran off the right edge of a phone on every public page. It only shows a link for each public
// feature that is on, so this turns all four on to get the longest nav, which makes it one of
// the specs that change flags (FEATURE_SPECS in playwright.config.js: serial, restores them).
test.use({ viewport: { width: 360, height: 800 } });

test.describe("Public site header on a phone (360px)", () => {
  let previousFeatures;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    previousFeatures = await setFeatures(page.request, {
      publicDirectory: true,
      publicMap: true,
      publicPrayerDigest: true,
      publicTripDiscovery: true,
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

  for (const path of ["/", "/map", "/trips"]) {
    test(`${path} keeps its header nav on screen`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector("header.app-header");
      await page.waitForTimeout(500);
      const problems = await layoutProblems(page);
      expect(problems.offenders, "elements past the screen edge").toEqual([]);
      expect(problems.pageOverflow, "px the page scrolls sideways").toBe(0);
    });
  }
});
