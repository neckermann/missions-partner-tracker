import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Prayer requests", () => {
  test("create on a missionary, record an answer, and confirm it appears publicly with no negative framing for other open requests", async ({ page }) => {
    await login(page);

    const missionariesRes = await page.request.get("/api/missionaries");
    const missionaries = await missionariesRes.json();
    // toPublicMissionary() excludes archived records regardless of
    // isPublic, and strips prayer requests (along with sendingChurch,
    // the real overview, etc.) entirely for restricted ones -- see
    // maskData.js. Need a record that's actually public in the full
    // sense, or the "shows on the public profile" assertion below can
    // never pass no matter how correct the app's masking is.
    const target = missionaries.find((m) => m.isPublic && !m.archived && !m.isRestricted) || missionaries[0];

    await page.goto(`/admin/missionaries/${target.id}`);
    await page.waitForSelector("h2");

    const uniqueText = `E2E prayer request ${Date.now()}`;
    await page.click("button:has-text('+ Add Prayer Request')");
    await page.selectOption("select", { label: "Strategic (ministry vision/calling — can be shared publicly)" });
    await page.fill("textarea", uniqueText);
    await page.locator('input[type="checkbox"]').first().check(); // "Show on public profile"
    await page.click('button[type="submit"]:has-text("Add Prayer Request")');

    const section = page.locator(".admin-section", { hasText: "Prayer Requests" }).first();
    await expect(section).toContainText(uniqueText);

    // A freshly-created ("ongoing") request shows no status callout at all --
    // not "Pending", not "Unanswered", nothing. See the PrayerRequest model
    // comment in schema.prisma for why.
    const sectionText = await section.innerText();
    expect(sectionText).not.toMatch(/unanswered|pending/i);

    // Record an answer
    await page.click("button:has-text('Record Answer')");
    await page.fill('input[placeholder*="clinic"]', "Answered during this test run");
    await page.click('button:has-text("Save")');
    await expect(section).toContainText("✓ Answered");
    await expect(section).toContainText("Answered during this test run");

    // Only a fully-public, non-archived, non-restricted record shows
    // prayer requests at all on the public site (see maskData.js) -- the
    // request (now answered) should show there too, filtered correctly
    // by category+isPublic.
    if (target.isPublic && !target.archived && !target.isRestricted) {
      await page.goto(`/partners/missionary/${target.id}`);
      await expect(page.locator("body")).toContainText(uniqueText);
      await expect(page.locator("body")).toContainText("Answered during this test run");
    }

    // Cleanup
    const prRes = await page.request.get("/api/prayer-requests");
    const all = await prRes.json();
    const created = all.find((r) => r.requestText === uniqueText);
    expect(created).toBeTruthy();
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
