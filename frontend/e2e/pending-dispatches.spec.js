import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Zero prior coverage of this page (flagged in Phase 5 of the UX-rebuild
// plan). Every prayer request/one-time need/newsletter creation always
// records a DispatchRecord (see dispatchRecording.js's own comment --
// recording doesn't depend on any channel being enabled, only delivery
// does), so creating one here is a reliable, deterministic way to get a
// real row onto this page without seeding or mocking anything.
let previousFeatures;

test.describe("Pending Dispatches", () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await restoreFeatures(page.request, previousFeatures);
    await context.close();
  });

  test("a newly created prayer request appears in the queue, grouped under its partner, and can be cleared", async ({
    page,
  }) => {
    await login(page);

    // The page itself (RequireAdminFeature in main.jsx) needs at least one
    // of groupme/whatsapp/outboundEmail on, even though recording a
    // dispatch never depends on any channel being enabled. setFeatures (helpers.js)
    // merges into the stored flags instead of replacing them.
    previousFeatures = await setFeatures(page.request, { outboundEmail: true });

    // restricted=false, same reasoning as helpers.js's own
    // firstSelectablePartner -- a restricted partner's real name never
    // reaches this (or any) dispatch-facing view (maskData.js), so
    // asserting target.displayName against a row built from a restricted
    // missionaries[0] fails on exactly the data this test never meant to
    // exercise.
    const missionariesRes = await page.request.get("/api/partners?kind=missionary&restricted=false");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    const uniqueText = `E2E dispatch ${Date.now()}`;
    await page.goto(`/admin/partners/${target.id}`);
    await page.waitForSelector("h2");
    const card = page.locator(".partner-summary-card", { hasText: "Prayer Requests" });
    await card.locator("button", { hasText: "+ Add" }).click();
    await page.selectOption(".modal-panel select", {
      label: "Strategic (ministry vision/calling — can be shared publicly)",
    });
    await page.fill(".modal-panel textarea", uniqueText);
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);
    await expect(card).toContainText(uniqueText);

    await page.goto("/admin/pending-dispatches");
    await page.waitForSelector("h2:has-text('Pending Dispatches')");

    // Confirms the real request text reached the queue (not a placeholder)
    // and that its row shows the right partner -- the consolidated page is
    // a shared <Table>, one row per blurb, grouped together by partner via
    // row ordering (flattenRows) rather than a visual group container.
    const row = page.locator("tr", { hasText: uniqueText });
    await expect(row).toBeVisible();
    await expect(row).toContainText(target.displayName);
    await row.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText(uniqueText)).toHaveCount(0);
  });
});
