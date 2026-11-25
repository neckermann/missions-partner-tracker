import { test, expect } from "@playwright/test";
import { login, layoutProblems } from "./helpers.js";

// Phone-width smoke test: the main admin pages must not scroll sideways or push anything past
// the screen edge, and the notification bell's dropdown must open on screen. Both were real
// bugs (a bell dropdown ~250px off the edge, a partner page whose Edit and Delete buttons were
// pushed off by a long link, a table widening the Financial tab). The pages that broke are set
// up with the data that broke them: a long unbreakable URL and a trip contribution.
test.use({ viewport: { width: 390, height: 800 } });

test.describe("Phone layout (390px)", () => {
  let partnerId;
  let linkId; // a link this spec created
  let borrowedLink; // or an existing link whose URL it replaced: { id, url }
  let tripId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const partners = await (await page.request.get("/api/partners?restricted=false&archived=false")).json();
    partnerId = (partners.partners || partners)[0]?.id;
    expect(partnerId, "expected a seeded non-restricted, non-archived partner").toBeTruthy();

    // A partner can hold one link per type and the seed may already give this partner some, so
    // use a type it doesn't have. If every type is taken (unlikely), borrow one: set a long URL
    // on it now and put its own URL back afterwards.
    const longUrl = `https://give.example.com/${"a-long-unbroken-path-".repeat(6)}`;
    const existing = await (await page.request.get(`/api/partner-links?partnerId=${partnerId}`)).json();
    const taken = new Set(existing.map((l) => l.type));
    const freeType = [
      "website",
      "support",
      "newsletterSignup",
      "facebook",
      "twitter",
      "instagram",
      "linkedin",
    ].find((type) => !taken.has(type));
    if (freeType) {
      const link = await page.request.post("/api/partner-links", {
        data: { partnerId, type: freeType, url: longUrl },
      });
      expect(link.ok(), "creating the long link").toBeTruthy();
      linkId = (await link.json()).id;
    } else {
      borrowedLink = { id: existing[0].id, url: existing[0].url };
      const res = await page.request.put(`/api/partner-links/${borrowedLink.id}`, { data: { url: longUrl } });
      expect(res.ok(), "setting the long link").toBeTruthy();
    }

    const trip = await page.request.post("/api/trips", {
      data: {
        partnerId,
        status: "accepting_applications",
        isPublic: false,
        type: "Construction",
        startDate: "2027-09-01",
        endDate: "2027-09-10",
      },
    });
    expect(trip.ok()).toBeTruthy();
    tripId = (await trip.json()).id;
    const contribution = await page.request.post(`/api/trips/${tripId}/contributions`, {
      data: { donorName: "Aunt Hannah", amount: 100, method: "check", receivedDate: "2027-01-15" },
    });
    expect(contribution.ok()).toBeTruthy();
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    if (linkId) await page.request.delete(`/api/partner-links/${linkId}`);
    if (borrowedLink) {
      await page.request.put(`/api/partner-links/${borrowedLink.id}`, { data: { url: borrowedLink.url } });
    }
    if (tripId) await page.request.delete(`/api/trips/${tripId}`);
    await context.close();
  });

  test("the notification bell's dropdown opens fully on screen", async ({ page }) => {
    await login(page);
    await page.locator('[title="Notifications"]').click();
    const box = await page.locator(".admin-sidebar-bell-dropdown").boundingBox();
    expect(box, "the dropdown did not open").toBeTruthy();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  test("the menu starts closed so the page is on the first screen, and closes after choosing a page", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/partners");
    const heading = page.getByRole("heading", { name: /Partners/ }).first();
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box.y + box.height, "the page heading is below the first screen").toBeLessThan(800);

    const menu = page.getByRole("button", { name: /Menu/ });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".admin-sidebar-nav")).toBeHidden();

    await menu.click();
    await expect(page.locator(".admin-sidebar-nav")).toBeVisible();
    await page.locator(".admin-sidebar-nav").getByRole("link", { name: /Home/ }).click();
    await page.waitForURL(/\/admin$/);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".admin-sidebar-nav")).toBeHidden();
  });

  const routes = [
    ["the dashboard", () => "/admin"],
    ["the Partners list", () => "/admin/partners"],
    ["a partner page with a long link", () => `/admin/partners/${partnerId}`],
    ["the Trips list", () => "/admin/trips"],
    ["a trip's Financial tab", () => `/admin/trips/${tripId}/financial`],
    ["Settings", () => "/admin/settings"],
    ["Manage Users", () => "/admin/settings/users"],
  ];
  for (const [name, path] of routes) {
    test(`${name} does not scroll sideways or run off the screen`, async ({ page }) => {
      await login(page);
      await page.goto(path());
      await page.waitForSelector("h1, h2");
      await page.waitForTimeout(500);
      const problems = await layoutProblems(page);
      expect(problems.offenders, "elements past the screen edge").toEqual([]);
      expect(problems.pageOverflow, "px the page scrolls sideways").toBe(0);
    });
  }
});
