import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Covers the Team tab's shared Table + Modal/QuickActionModal flows end to end against a real
// trip: "add participant directly" and "review a pending application".
test.describe("Trip Team tab: Table + Modal", () => {
  let tripId;
  let previousFeatures;
  let previousPrivateLinks;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    previousFeatures = await setFeatures(page.request, { trips: true });
    // "reviews a pending application" below generates a private application link, which the
    // trip settings must allow. Nothing else turns that on: CI only passed because the backend
    // route tests, run first against the same database, happened to leave it on, so on a
    // freshly seeded database this spec failed. Set it here and put it back after.
    previousPrivateLinks = (await (await page.request.get("/api/settings/trips")).json())
      .allowPrivateApplicationLinks;
    await page.request.put("/api/settings/trips", { data: { allowPrivateApplicationLinks: true } });

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
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    if (tripId) await page.request.delete(`/api/trips/${tripId}`);
    if (previousPrivateLinks !== undefined) {
      await page.request.put("/api/settings/trips", {
        data: { allowPrivateApplicationLinks: previousPrivateLinks },
      });
    }
    await restoreFeatures(page.request, previousFeatures);
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
    // Required for a non-completed trip -- POST /:id/participants 400s
    // without it (tripParticipants.js).
    await page.getByLabel("Email").fill(`e2e-direct-${Date.now()}@example.test`);
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);

    // Scoped to the Confirmed Team table specifically -- Applications
    // awaiting review (below it) has its own "Name" column too, so a bare
    // `.admin-table` filtered on "Name" is a strict-mode ambiguity once
    // both tables are on the page.
    const confirmedTeamSection = page.locator(".admin-section", {
      has: page.getByRole("heading", { name: "Confirmed Team" }),
    });
    await expect(confirmedTeamSection.locator(".admin-table")).toContainText(uniqueName);
  });

  test("reviews a pending application via its own detail page", async ({ page }) => {
    await login(page);
    // The plain id-addressed /apply route 404s unless the trip is public
    // AND the publicTripDiscovery feature is on, which is another spec's to
    // turn on. The by-token route only checks trip status, so it's the one
    // to use from here.
    const linkRes = await page.request.post(`/api/trips/${tripId}/generate-application-link`);
    expect(linkRes.ok()).toBeTruthy();
    const { applicationShareToken } = await linkRes.json();

    const uniqueEmail = `e2e-review-${Date.now()}@example.test`;
    const applyRes = await page.request.post(`/api/public/trips/by-token/${applicationShareToken}/apply`, {
      // dateOfBirth is required unconditionally (publicTripApplications.js) --
      // informs the minor/parent-guardian flow, not optional here.
      data: { firstName: "Review", lastName: "Applicant", email: uniqueEmail, dateOfBirth: "1990-01-01" },
    });
    expect(applyRes.ok()).toBeTruthy();

    await page.goto(`/admin/trips/${tripId}/team`);
    await page.waitForSelector("h3:has-text('Applications awaiting review')");

    const row = page.locator("tbody tr", { hasText: "Review Applicant" });
    await expect(row).toBeVisible();
    await row.click();

    // Row click navigates to the application's own detail page (AdminTripApplicationDetail.jsx),
    // not a Modal.
    await page.waitForURL(/\/admin\/trips\/[^/]+\/applications\/[^/]+$/);
    await expect(page.locator("body")).toContainText(uniqueEmail);
    // "Approve or Decline" opens one Wizard for both outcomes (Decision, then Confirm), showing
    // what the decision will do before doing it.
    await page.getByRole("button", { name: "Approve or Decline" }).click();
    await page.getByLabel("Approve").check();
    await page.getByRole("button", { name: "Next" }).click(); // Decision -> Confirm
    await page.getByRole("button", { name: "Finish" }).click();
    // outboundEmail is off by default (CI never turns it on globally), so
    // finishing lands on the manual-link end page, not an immediate
    // navigation -- "Done" dismisses it. See
    // AdminTripApplicationDetail.jsx's handleFinish.
    await page.getByRole("button", { name: "Done" }).click();

    // Approving navigates straight to the new participant's detail page.
    await page.waitForURL(/\/admin\/trips\/[^/]+\/participants\/[^/]+$/);
    await expect(page.locator("body")).toContainText("Review");
    await expect(page.locator("body")).not.toContainText(
      /cannot read|undefined is not|something went wrong/i
    );
  });
});
