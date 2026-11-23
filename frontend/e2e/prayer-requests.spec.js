import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Prayer requests", () => {
  test("quick-add from Partner Detail and record an answer, with no negative framing for other open requests", async ({
    page,
  }) => {
    await login(page);

    const missionariesRes = await page.request.get("/api/partners?kind=missionary");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    await page.goto(`/admin/partners/${target.id}`);
    await page.waitForSelector("h2");

    const card = page.locator(".partner-summary-card", { hasText: "Prayer Requests" });
    const uniqueText = `E2E prayer request ${Date.now()}`;
    await card.locator("button", { hasText: "+ Add" }).click();
    await page.selectOption(".modal-panel select", {
      label: "Strategic (ministry vision/calling — can be shared publicly)",
    });
    await page.fill(".modal-panel textarea", uniqueText);
    await page.locator('.modal-panel input[type="checkbox"]').first().check(); // "Show on public profile"
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);

    await expect(card).toContainText(uniqueText);

    // A freshly-created ("ongoing") request shows no status callout at all --
    // not "Pending", not "Unanswered", nothing. See the PrayerRequest model
    // comment in schema.prisma for why.
    const cardText = await card.innerText();
    expect(cardText).not.toMatch(/unanswered|pending/i);

    // Record an answer via the item's own popup -- the card itself only
    // ever offers "+ Add" now (a card-level "Mark Answered" used to act on
    // whichever request happened to be prayerRequests[0], silently wrong
    // whenever more than one request was still unanswered).
    await card.locator("button.summary-item-link", { hasText: uniqueText }).click();
    await expect(page.locator(".modal-panel")).toContainText("Prayer Request");
    await page.locator(".modal-panel button", { hasText: "Mark Answered" }).click();
    await page.fill(
      '.modal-panel input[type="text"], .modal-panel input:not([type])',
      "Answered during this test run"
    );
    await page.click('.modal-panel button[type="submit"]');
    await expect(page.locator(".modal-panel")).toHaveCount(0);

    // Cleanup, and confirm the answer actually persisted server-side
    const prRes = await page.request.get("/api/prayer-requests");
    const all = await prRes.json();
    const created = all.find((r) => r.requestText === uniqueText);
    expect(created).toBeTruthy();
    expect(created.status).toBe("answered");
    expect(created.answeredNote).toBe("Answered during this test run");
    const del = await page.request.delete(`/api/prayer-requests/${created.id}`);
    expect(del.ok()).toBeTruthy();
  });

  test("consolidated admin page lists requests with no status badge for open ones", async ({ page }) => {
    await login(page);
    await page.goto("/admin/prayer-requests");
    await page.waitForSelector("h2:has-text('Prayer Requests')");

    // Whatever's on this page (seed data varies), it should never render
    // language implying an open request is a problem.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/unanswered|pending decision|still waiting/i);
  });
});
