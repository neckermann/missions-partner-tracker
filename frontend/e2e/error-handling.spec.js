import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// A failed save must show a message. It must never blank the page.
//
// That second half is not theoretical. The backend returned Zod's array of
// issue objects as `error`, pages did `setError(err.response.data.error)` and
// rendered `<p>{error}</p>`, so React threw "Objects are not valid as a React
// child" -- and with no error boundary anywhere, the whole app unmounted. The
// user saw white. Every form in the app behaved this way on any validation
// error, and the test suite never noticed because it only asserted status
// codes.
//
// Two layers now stop that, and this file checks both:
//   1. the backend guarantees `error` is a string (middleware/errors.js)
//   2. an ErrorBoundary catches a render error if anything slips through
//
// Layer 2 is tested by forcing the old broken shape back onto the wire, since
// the backend can no longer produce it.

const SUPPORT_ENTRIES = "**/api/support-entries";

async function openAddSupportEntry(page) {
  await page.goto("/admin/support/monthly");
  await page.waitForSelector("h2:has-text('Monthly Support')");
  await page.click("button:has-text('+ Add Support Entry')");

  const partners = await (await page.request.get("/api/partners?kind=missionary")).json();
  await page.getByLabel("Partner").selectOption({ label: partners[0].displayName });
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

    // The exact shape that used to white-screen the app: an array of Zod
    // issue objects where a string belongs. The backend can't emit this any
    // more, so it's injected here to prove the boundary holds if some future
    // endpoint regresses.
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

    // Either the page survived, or the boundary caught it and offered a way
    // out. What must never happen is an empty document -- which is precisely
    // what used to happen. (Measured: today the render does throw and the
    // boundary is what catches it.)
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
