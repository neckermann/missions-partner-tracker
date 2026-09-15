import { test, expect } from "@playwright/test";

// Until v2.0.2 the app shipped as one bundle, so a visitor who only ever
// looked at the public directory still downloaded every admin page --
// including the printed-booklet templates and the settings screens. No
// partner data was exposed (admin endpoints are behind requireAuth and the
// public API runs through the masking serializer), but it handed an
// anonymous visitor a readable map of the admin app and made them pay for
// code they can't reach.
//
// These assert on what the browser actually downloads, not on the build
// output, so they'd catch a regression from any cause -- a stray top-level
// import into main.jsx being the likely one.

// Markers that only appear in admin-only code paths. Deliberately these
// are capabilities (endpoints, libraries) rather than UI copy: the route
// guards stay eagerly loaded and carry strings like "Church Settings ›
// Features" for their turn-it-back-on message, which is a nav hint, not a
// leak of how the admin app works.
const ADMIN_ONLY_MARKERS = [
  "paged.polyfill", // the booklet's pagination library URL
  "booklet-page", // the booklet's print stylesheet class
  "/api/support-entries", // admin-only endpoints
  "/api/prayer-requests",
  "/api/sso-providers",
];

async function scriptsLoadedOn(page, path) {
  const urls = new Set();
  page.on("response", (res) => {
    const url = res.url();
    if (url.endsWith(".js") && new URL(url).origin === new URL(page.url() || url).origin) urls.add(url);
  });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  return [...urls];
}

test.describe("public bundle", () => {
  test("an anonymous visit to the directory downloads no admin code", async ({ page }) => {
    const scripts = await scriptsLoadedOn(page, "/");
    expect(scripts.length).toBeGreaterThan(0);

    for (const url of scripts) {
      const body = await (await page.request.get(url)).text();
      for (const marker of ADMIN_ONLY_MARKERS) {
        expect(body, `${marker} leaked into ${url.split("/").pop()}`).not.toContain(marker);
      }
    }
  });

  test("the public directory still renders without the admin chunks", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".partner-card").first()).toBeVisible();
  });

  test("the map still works, lazily loaded", async ({ page }) => {
    await page.goto("/map");
    await expect(page.locator(".leaflet-container")).toBeVisible();
  });
});
