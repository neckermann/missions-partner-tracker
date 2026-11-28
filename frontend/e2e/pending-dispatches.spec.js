import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Every prayer request/one-time need/newsletter creation records a DispatchRecord while some
// channel is enabled (see dispatchRecording.js), so creating one here is a deterministic
// way to get a real row onto this page without seeding or mocking.
let previousFeatures;

test.describe("Updates to Share", () => {
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

    // The page (RequireAdminFeature in main.jsx) needs at least one of
    // groupme/whatsapp/outboundEmail on, and recording needs one too.
    // setFeatures (helpers.js) merges into the stored flags.
    previousFeatures = await setFeatures(page.request, { outboundEmail: true });

    // restricted=false, as in helpers.js's firstSelectablePartner: a restricted partner's real
    // name never reaches a dispatch-facing view (maskData.js), so asserting target.displayName
    // against a restricted missionaries[0] would fail.
    const missionariesRes = await page.request.get("/api/partners?kind=missionary&restricted=false");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    const uniqueText = `E2E dispatch ${Date.now()}`;
    await page.goto(`/admin/partners/${target.id}`);
    await page.waitForSelector("h2");
    const card = page.locator(".partner-summary-card", { hasText: "Prayer Requests" });
    await card.locator("button", { hasText: "+ Add" }).click();
    await page.selectOption(".modal-panel select", {
      label: "Ministry (their work and calling — can be shared publicly)",
    });
    await page.fill(".modal-panel textarea", uniqueText);
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);
    await expect(card).toContainText(uniqueText);

    await page.goto("/admin/pending-dispatches");
    await page.waitForSelector("h2:has-text('Updates to Share')");

    // Confirms the real request text reached the queue (not a placeholder) and that its row shows
    // the right partner; the page is a shared <Table>, grouped by partner via row ordering
    // (flattenRows).
    const row = page.locator("tr", { hasText: uniqueText });
    await expect(row).toBeVisible();
    await expect(row).toContainText(target.displayName);
    await row.getByRole("button", { name: "Clear" }).click();
    // Clearing asks first; cancelling leaves the update where it was.
    const dialog = page.getByRole("dialog", { name: "Clear this update?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Clear" }).click();
    await page
      .getByRole("dialog", { name: "Clear this update?" })
      .getByRole("button", { name: "Clear" })
      .click();
    await expect(page.getByText(uniqueText)).toHaveCount(0);
  });
});
