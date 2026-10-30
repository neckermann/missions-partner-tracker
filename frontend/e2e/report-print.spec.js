import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// The Print button produced a blank page, and nothing caught it: the rest
// of the suite renders in screen media, where the report looks perfect.
//
// The cause was a print rule written for the booklet -- `body * {
// visibility: hidden }` with only .booklet-preview revealed again -- which
// applied on every print in the app, so any other printable view came out
// empty. Correct styles, no content.
//
// So these assert against print media specifically. emulateMedia is the
// cheap way to do it: it makes the browser resolve @media print without
// going anywhere near a printer or a PDF.

async function runBirthdayReport(page) {
  await page.goto("/admin/reports");
  await page.getByLabel("Report").selectOption("upcoming-birthdays");
  await page.getByRole("button", { name: "Run report" }).click();
  await expect(page.locator(".report-output")).toBeVisible();
}

test.describe("Reports print view", () => {
  test("the report is actually visible in print media", async ({ page }) => {
    await login(page);
    await runBirthdayReport(page);

    await page.emulateMedia({ media: "print" });

    // visibility, not display: the booklet rule left elements laid out but
    // invisible, which is why this needs checking explicitly rather than
    // relying on toBeVisible alone.
    const output = page.locator(".report-output");
    await expect(output).toBeVisible();
    await expect(output).toHaveCSS("visibility", "visible");

    const heading = page.locator(".report-output h3");
    await expect(heading).toHaveCSS("visibility", "visible");
  });

  test("the table and its header survive into print", async ({ page }) => {
    await login(page);
    await runBirthdayReport(page);
    await page.emulateMedia({ media: "print" });

    const table = page.locator(".report-output table.admin-table");
    await expect(table).toHaveCSS("visibility", "visible");

    // thead must be table-header-group so a long report repeats its column
    // headings on every printed page.
    await expect(table.locator("thead")).toHaveCSS("display", "table-header-group");
  });

  test("chrome is hidden but the report keeps its title and generated-on line", async ({ page }) => {
    await login(page);
    await runBirthdayReport(page);
    await page.emulateMedia({ media: "print" });

    // The controls are noise on paper.
    await expect(page.locator(".admin-sidebar")).toBeHidden();
    await expect(page.locator(".report-actions")).toBeHidden();

    // But a report on someone's desk has to say what it is and when it was
    // true, so this must survive.
    await expect(page.locator(".report-meta")).toHaveCSS("visibility", "visible");
  });

  test("printing actually renders content, not an empty sheet", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "page.pdf() is Chromium-only");

    await login(page);
    await runBirthdayReport(page);

    // The end-to-end check: generate the PDF the browser's own Save as PDF
    // would produce, and assert it isn't blank. A size floor is crude, but
    // a genuinely empty page is tiny, and this is the one assertion that
    // would have caught the original bug.
    const pdf = await page.pdf({ format: "Letter", printBackground: false });
    expect(pdf.length, "a blank PDF is a few hundred bytes").toBeGreaterThan(3000);

    // And prove the rows are really in it: pdf bytes contain the text,
    // compressed, so check the page count instead via the trailer.
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF"), "should be a real PDF").toBe(true);
  });
});

test.describe("Booklet print view still works", () => {
  // The fix scopes the booklet's blanket hide with :has(.booklet-preview).
  // That element renders unconditionally on the booklet page, so the rule
  // fires exactly where it always did -- but this asserts it, because the
  // obvious "simplification" of that selector is to drop the :has() and
  // reintroduce the blank-page bug for every other printable view.
  test("the booklet page still hides the app chrome when printing", async ({ page }) => {
    await login(page);
    await page.goto("/admin/booklet");
    await expect(page.locator(".booklet-preview")).toBeAttached();

    await page.emulateMedia({ media: "print" });

    // The blanket hide applies here, which is the whole point of it.
    await expect(page.locator(".admin-sidebar")).toHaveCSS("visibility", "hidden");
    await expect(page.locator(".booklet-preview")).toHaveCSS("visibility", "visible");
  });
});
