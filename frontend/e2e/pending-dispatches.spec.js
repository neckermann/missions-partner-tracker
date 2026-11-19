import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Zero prior coverage of this page (flagged in Phase 5 of the UX-rebuild
// plan). Every prayer request/one-time need/newsletter creation always
// records a DispatchRecord (see dispatchRecording.js's own comment --
// recording doesn't depend on any channel being enabled, only delivery
// does), so creating one here is a reliable, deterministic way to get a
// real row onto this page without seeding or mocking anything.
test.describe("Pending Dispatches", () => {
  test("a newly created prayer request appears in the queue, grouped under its partner, and can be cleared", async ({
    page,
  }) => {
    await login(page);

    // The page itself (RequireAdminFeature in main.jsx) needs at least one
    // of groupme/whatsapp/outboundEmail on, even though recording a
    // dispatch never depends on any channel being enabled.
    await page.request.put("/api/settings", { data: { enabledFeatures: { outboundEmail: true } } });

    const missionariesRes = await page.request.get("/api/partners?kind=missionary");
    const missionaries = await missionariesRes.json();
    const target = missionaries[0];

    const uniqueText = `E2E dispatch ${Date.now()}`;
    await page.goto(`/admin/partners/${target.id}`);
    await page.waitForSelector("h2");
    await page.click("button:has-text('+ Add Prayer Request')");
    await page.selectOption("select", {
      label: "Strategic (ministry vision/calling — can be shared publicly)",
    });
    await page.fill("textarea", uniqueText);
    await page.click('button[type="submit"]:has-text("Add Prayer Request")');
    await expect(page.locator(".admin-section", { hasText: "Prayer Requests" }).first()).toContainText(
      uniqueText
    );

    await page.goto("/admin/pending-dispatches");
    await page.waitForSelector("h2:has-text('Pending Dispatches')");

    // Confirms the real request text reached the queue (not a placeholder)
    // and that it's grouped under the right partner -- BlurbRow renders
    // bodyText as its own <p>, inside a group headed by the partner's
    // <strong>{displayName}</strong> (groupByPartner).
    const bodyParagraph = page.locator("p", { hasText: uniqueText });
    await expect(bodyParagraph).toBeVisible();
    const group = page.locator("div", { has: page.getByText(target.displayName, { exact: true }) }).last();
    await expect(group).toContainText(uniqueText);

    // bodyParagraph's grandparent is BlurbRow's own outer wrapper div --
    // its parent is just the left-hand content div, a sibling of the
    // right-hand actions div the Clear button lives in.
    const row = bodyParagraph.locator("xpath=../..");
    await row.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText(uniqueText)).toHaveCount(0);
  });
});
