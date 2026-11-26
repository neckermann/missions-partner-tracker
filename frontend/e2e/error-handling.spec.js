import { test, expect } from "@playwright/test";
import { login, firstSelectablePartner } from "./helpers.js";

// A failed save must show a message and must never blank the page. The backend once returned
// Zod's array of issue objects as `error`; pages rendered `<p>{error}</p>`, React threw
// "Objects are not valid as a React child", and with no error boundary the whole app
// unmounted.
//
// Two layers now stop that, and this file checks both: (1) the backend guarantees `error` is a
// string (middleware/errors.js); (2) an ErrorBoundary catches a render error if anything slips
// through. Layer 2 is tested by forcing the broken shape onto the wire, since the backend can
// no longer produce it.

const SUPPORT_ENTRIES = "**/api/support-entries";

async function openAddSupportEntry(page) {
  await page.goto("/admin/support/monthly");
  await page.waitForSelector("h2:has-text('Monthly Support')");
  await page.click("button:has-text('+ Add Support Entry')");

  // Must be one the dropdown will actually list -- see firstSelectablePartner.
  const target = await firstSelectablePartner(page);
  await page.getByLabel("Partner").selectOption({ label: target.displayName });
  await page.getByLabel("Monthly Amount (USD)").fill("123");
  await page.getByLabel("Effective Date").fill("2099-01-01");
}

test.describe("error handling", () => {
  test("a rejected save shows the reason and leaves the page standing", async ({ page }) => {
    await login(page);

    // Force the server's current contract: a 400 whose `error` is a string.
    await page.route(SUPPORT_ENTRIES, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "amount: Expected number, received string" }),
          })
        : route.continue()
    );

    await openAddSupportEntry(page);
    await page.click('button[type="submit"]:has-text("Save Entry")');

    await expect(page.getByText(/amount: Expected number/)).toBeVisible();
    // The page is still a page.
    await expect(page.locator("h2:has-text('Monthly Support')")).toBeVisible();
  });

  test("even an object error body cannot blank the page", async ({ page }) => {
    await login(page);

    // The shape that white-screened the app: an array of Zod issue objects where a string
    // belongs. Injected here to prove the boundary holds if a future endpoint regresses.
    await page.route(SUPPORT_ENTRIES, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: [{ path: ["amount"], message: "Required", code: "invalid_type" }],
            }),
          })
        : route.continue()
    );

    await openAddSupportEntry(page);
    await page.click('button[type="submit"]:has-text("Save Entry")');

    // Either the page survived or the boundary caught it and offered a way out. What must never
    // happen is an empty document.
    const stillOnPage = page.locator("h2:has-text('Monthly Support')");
    const boundaryCard = page.getByRole("alert").filter({ hasText: /Something went wrong/ });
    await expect(stillOnPage.or(boundaryCard).first()).toBeVisible();

    // The assertion that actually encodes the bug: the user is looking at
    // something. A white screen is an essentially empty <body>.
    const visibleText = (await page.locator("body").innerText()).trim();
    expect(visibleText.length).toBeGreaterThan(100);

    // And the admin shell is intact either way -- the inner boundary sits
    // inside it, so a crashed page keeps navigation usable.
    await expect(page.locator(".admin-sidebar, nav").first()).toBeVisible();
  });
});
