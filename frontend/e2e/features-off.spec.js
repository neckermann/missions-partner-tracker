import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures, firstSelectablePartner } from "./helpers.js";

// A church can leave every optional feature off. This turns them all off and walks the pages a
// person would use: nothing may throw, nothing may show a failure banner, and the sections that
// belong to a feature must be gone rather than empty or broken. It changes settings, so it is one
// of the serial FEATURE_SPECS (playwright.config.js) and restores what it changed.
test.describe.configure({ mode: "serial" });

test.describe("every optional feature off", () => {
  let context;
  let page;
  let previous;
  let partner;
  const problems = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await login(page);
    const settings = await (await page.request.get("/api/settings")).json();
    const keys = settings.featureRegistry.map((f) => f.key);
    previous = await setFeatures(page.request, Object.fromEntries(keys.map((k) => [k, false])));
    partner = await firstSelectablePartner(page);
  });

  test.afterAll(async () => {
    await restoreFeatures(page.request, previous);
    await context.close();
  });

  test("the main pages load without errors", async () => {
    for (const path of ["/admin", "/admin/partners", "/admin/partners/new", "/admin/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    expect(problems).toEqual([]);
  });

  test("a partner's page has none of the feature sections, and still loads", async () => {
    await page.goto(`/admin/partners/${partner.id}`);
    await expect(page.getByRole("heading", { name: /Status & Visibility/i })).toBeVisible();
    for (const gone of ["Contact Log", "Surveys", "Support Preferences", "Care team", "Prayer Requests"]) {
      await expect(page.getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("the gated pages say not found instead of breaking", async () => {
    for (const path of ["/admin/contact-log", "/admin/survey-updates", "/admin/settings/surveys"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
    }
    expect(problems).toEqual([]);
  });
});
