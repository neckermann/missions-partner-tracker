// Dev-only helper: render the Reports print view and save it as a PNG so a
// human (or Claude) can look at it, plus the PDF the browser would produce.
//
// Not a test -- it asserts nothing. Print styling is one of the few things
// in this app you genuinely have to see, because every other view in the
// suite renders in screen media where the print rules never apply.
//
//   node e2e/print-preview.mjs [outDir]
//
// Needs the app running on E2E_BASE_URL (default http://localhost:4000).

import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:4000";
const EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";
const outDir = process.argv[2] || ".";
const report = process.env.REPORT || "upcoming-birthdays";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/);

await page.goto(`${BASE}/admin/reports`);
await page.getByLabel("Report").selectOption(report);
await page.getByRole("button", { name: "Run report" }).click();
await page.locator(".report-output").waitFor();

// Screen first, for comparison.
await page.screenshot({ path: path.join(outDir, "report-screen.png"), fullPage: true });

// Then the thing that matters.
await page.emulateMedia({ media: "print" });
await page.screenshot({ path: path.join(outDir, "report-print.png"), fullPage: true });
await page.pdf({
  path: path.join(outDir, "report-print.pdf"),
  format: "Letter",
  printBackground: true,
});

const rows = await page.locator(".report-output tbody tr").count();
console.log(`rendered ${report}: ${rows} rows -> report-print.png / .pdf in ${outDir}`);

await browser.close();
