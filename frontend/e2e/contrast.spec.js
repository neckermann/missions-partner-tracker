import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";
import { lowContrastText } from "./helpers-contrast.js";

// Text a person can't read, in either theme (#418). Every visible piece of text is checked
// against the background it actually sits on (WCAG AA: 4.5:1, or 3:1 for large text), in the
// browser, with the theme the page really renders. Hardcoded greys and whites that bypass the
// theme tokens are what broke dark mode, so this fails the build when one comes back.

const PUBLIC_ROUTES = ["/", "/partners", "/map", "/subscribe", "/prayer"];
const ADMIN_ROUTES = [
  "/admin",
  "/admin/partners",
  "/admin/trips",
  "/admin/trips/planning",
  "/admin/trips/contributions",
  "/admin/prayer-requests",
  "/admin/support/needs",
  "/admin/inbound-email",
  "/admin/pending-dispatches",
  "/admin/reports",
  "/admin/settings/about",
  "/admin/settings/audit",
  "/admin/settings/care-team",
  "/admin/settings/features",
  "/admin/settings/groupme",
  "/admin/settings/whatsapp",
  "/admin/settings/support-preferences",
  "/admin/settings/users",
];

function describe(problems) {
  return problems.map((p) => `${p.ratio}:1 ${p.selector} "${p.text}" (${p.color})`).join("\n");
}

for (const scheme of ["dark", "light"]) {
  test.describe(`Readable text, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("public pages", async ({ page }) => {
      for (const route of PUBLIC_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const problems = await lowContrastText(page);
        expect(problems, `${route}\n${describe(problems)}`).toEqual([]);
      }
    });

    test("admin pages", async ({ page }) => {
      await login(page);
      for (const route of ADMIN_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const problems = await lowContrastText(page);
        expect(problems, `${route}\n${describe(problems)}`).toEqual([]);
      }
    });
  });
}

// The booklet page's stylesheet used to set a dark text colour on the whole page and stay loaded
// after you left it, so the next admin page turned unreadable in dark mode until a refresh.
test.describe("Dark mode survives visiting the booklet", () => {
  test.use({ colorScheme: "dark" });

  test("an admin page read after the booklet is still readable", async ({ page }) => {
    await login(page);
    await page.goto("/admin/booklet");
    await page.waitForLoadState("networkidle");
    // Move on by clicking, not by a fresh load: a reload would hide the bug.
    await page.getByRole("link", { name: "Settings" }).first().click();
    await page.waitForLoadState("networkidle");
    const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bodyColor).not.toBe("rgb(34, 34, 34)");
    const problems = await lowContrastText(page);
    expect(problems, describe(problems)).toEqual([]);
  });
});
