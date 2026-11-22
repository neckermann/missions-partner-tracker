import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Regression coverage for the Team tab's migration off hand-rolled tables
// and a raw inline form onto the shared Table + Modal/QuickActionModal
// pattern (UX-consistency pass). Zero prior coverage of this page existed
// before this -- drives both the "add participant directly" flow and the
// "review a pending application" flow end to end against a real trip.
test.describe("Trip Team tab: Table + Modal", () => {
  let tripId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await page.request.put("/api/settings", { data: { enabledFeatures: { trips: true } } });

    const partnersRes = await page.request.get("/api/partners?restricted=false&archived=false");
    const partners = await partnersRes.json();
    const partnerId = (partners.partners || partners)[0]?.id;
    expect(partnerId, "expected at least one seeded non-restricted, non-archived partner").toBeTruthy();

    const tripRes = await page.request.post("/api/trips", {
      data: {
        partnerId,
        status: "accepting_applications",
        isPublic: false,
        type: "Construction",
        startDate: "2027-08-01",
        endDate: "2027-08-10",
      },
    });
    expect(tripRes.ok()).toBeTruthy();
    tripId = (await tripRes.json()).id;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!tripId) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await page.request.delete(`/api/trips/${tripId}`);
    await context.close();
  });

  test("adds a participant directly via the QuickActionModal", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/trips/${tripId}/team`);
    await page.waitForSelector("h3:has-text('Confirmed Team')");

    const uniqueName = `E2EDirect${Date.now()}`;
    await page.getByRole("button", { name: "+ Add participant directly" }).click();
    await expect(page.locator(".modal-panel")).toBeVisible();
    await page.getByLabel("First name").fill(uniqueName);
    await page.getByLabel("Last name").fill("Participant");
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);

    await expect(page.locator(".admin-table", { hasText: "Name" })).toContainText(uniqueName);
  });

  test("reviews a pending application via the row-click Modal", async ({ page }) => {
    const uniqueEmail = `e2e-review-${Date.now()}@example.test`;
    const applyRes = await page.request.post(`/api/public/trips/${tripId}/apply`, {
      data: { firstName: "Review", lastName: "Applicant", email: uniqueEmail },
    });
    expect(applyRes.ok()).toBeTruthy();

    await login(page);
    await page.goto(`/admin/trips/${tripId}/team`);
    await page.waitForSelector("h3:has-text('Applications awaiting review')");

    const row = page.locator("tbody tr", { hasText: "Review Applicant" });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.locator(".modal-panel")).toContainText(uniqueEmail);
    await page.locator(".modal-panel button", { hasText: "Approve" }).click();
    await expect(page.locator(".modal-panel")).toHaveCount(0);

    // Approving navigates straight to the new participant's own detail page
    // (same behavior as before this migration, unchanged).
    await page.waitForURL(/\/admin\/trips\/[^/]+\/participants\/[^/]+$/);
    await expect(page.locator("body")).toContainText("Review");
    await expect(page.locator("body")).not.toContainText(/cannot read|undefined is not|something went wrong/i);
  });
});
