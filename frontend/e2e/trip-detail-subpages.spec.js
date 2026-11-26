import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Creates its own trip rather than clicking the first row of the Existing Trips list: CI seeds
// zero trips (SEED_DEMO_EXTRAS=false), so that row only existed if another spec's parallel
// test created one first, a race under fullyParallel. Same self-contained beforeAll/afterAll
// pattern as trip-team-table-modal.spec.js.
let tripId;
let previousFeatures;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  previousFeatures = await setFeatures(page.request, { trips: true });

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
  await restoreFeatures(page.request, previousFeatures);
  await context.close();
});

test("trip detail sub-pages render without errors", async ({ page }) => {
  await login(page);
  await page.goto(`/admin/trips/${tripId}`);
  console.log("TRIP URL", page.url());
  await expect(page.getByText("Trip setup")).toBeVisible();
  for (const tab of ["Team", "Meetings", "Requirements", "Flights"]) {
    await page.getByRole("link", { name: new RegExp("^" + tab) }).click();
    await expect(page.locator("body")).not.toContainText(
      /cannot read|undefined is not|something went wrong/i
    );
  }

  // A participant's own detail page, reached from the Team tab.
  await page.getByRole("link", { name: /^Team/ }).click();
  const participantRow = page.locator("table tbody tr.row-clickable").first();
  if (await participantRow.count()) {
    // A clickable row opens from the keyboard too: focus it and press Enter.
    await participantRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Contact & access")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /cannot read|undefined is not|something went wrong/i
    );
  }
});
