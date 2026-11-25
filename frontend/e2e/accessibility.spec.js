import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers.js";

// Gates only on "serious"/"critical" violations; "moderate"/"minor" ones are tracked but don't
// block a deploy.
const FAILING_IMPACTS = ["serious", "critical"];

function summarize(violations) {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -- ${v.helpUrl}`)
    .join("\n");
}

test.describe("Accessibility", () => {
  test("public directory has no serious/critical violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".partner-card", { timeout: 10000 });
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact));
    expect(serious, summarize(serious)).toEqual([]);
  });

  test("public map has no serious/critical violations", async ({ page }) => {
    await page.goto("/map");
    await page.waitForSelector(".leaflet-container", { timeout: 10000 });
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact));
    expect(serious, summarize(serious)).toEqual([]);
  });

  test("login page has no serious/critical violations", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact));
    expect(serious, summarize(serious)).toEqual([]);
  });

  test("admin dashboard has no serious/critical violations", async ({ page }) => {
    await login(page);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact));
    expect(serious, summarize(serious)).toEqual([]);
  });
});
