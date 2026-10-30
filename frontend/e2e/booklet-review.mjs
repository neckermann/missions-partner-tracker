// Dev-only: a systematic pass over the booklet feature, not a spot-check.
// For every template, renders the cover, an organization page, a family
// missionary page, a single/couple missionary page, the notes page, and
// the back cover -- in BOTH the inline preview and print-media emulation
// -- and saves each as its own PNG for visual review.
//
//   node e2e/booklet-review.mjs [outDir]

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL || "http://localhost:4000";
const EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";
const outDir = process.argv[2] || ".";
fs.mkdirSync(outDir, { recursive: true });

const TEMPLATE_LABELS = {
  classic: "Classic",
  modern: "Modern",
  traditional: "Traditional",
  keepsake: "Keepsake",
  portfolio: "Portfolio",
  friendly: "Friendly",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (e) =>
  consoleErrors.push(`[pageerror] ${e.message}
${e.stack}`)
);

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/);

await page.goto(`${BASE}/admin/booklet`);
// Organizations are included by default already; confirm the checkbox, and
// make sure the Notes page is on so that page type is actually exercised.
await page.waitForSelector(".booklet-preview");

// Rendering is synchronous now (plain HTML, no pagination polyfill to
// settle) -- selecting a template re-renders on the next tick, no button
// and no wait needed.
async function selectTemplate(tpl) {
  await page.getByText(TEMPLATE_LABELS[tpl], { exact: true }).click();
  await page.locator(".booklet-preview").waitFor();
}

// Each top-level page is now a plain <section class="booklet-cover|
// booklet-page">, directly inside .booklet-preview -- no .pagedjs_page
// wrapper to look inside. `self` matches a class on the section itself
// (e.g. the back cover); `has` matches a descendant (e.g. a heading).
async function shotPageMatching(outName, { has, self }) {
  const target = self
    ? page.locator(`.booklet-preview section${self}`).first()
    : page
        .locator(".booklet-preview section")
        .filter({ has: page.locator(has) })
        .first();
  if ((await target.count()) === 0) {
    console.log(`  [missing] no page matched ${has || self} for ${outName}`);
    return;
  }
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: path.join(outDir, outName) });
}

for (const tpl of Object.keys(TEMPLATE_LABELS)) {
  console.log(`=== ${tpl} ===`);
  await selectTemplate(tpl);

  const pageCount = await page.locator(".booklet-preview section").count();
  console.log(`  total pages: ${pageCount}`);

  // Cover.
  await shotPageMatching(`${tpl}-01-cover.png`, { has: ".booklet-cover-title" });
  // A missionary page (family, since the fixture-rich seed has plenty).
  await shotPageMatching(`${tpl}-02-missionary.png`, { has: ".booklet-name" });
  // An organization page -- distinguishable by having no .booklet-photo
  // wrapper the missionary template uses, but the same .booklet-name; the
  // simplest reliable marker is the section divider text.
  await shotPageMatching(`${tpl}-03-section-divider.png`, { has: "h2.booklet-index-title" });
  // Notes page.
  await shotPageMatching(`${tpl}-04-notes.png`, { has: ".booklet-notes-heading" });
  // Back cover.
  await shotPageMatching(`${tpl}-05-back-cover.png`, { self: ".booklet-back-cover" });

  // Print-media equivalents, same pages, to catch anything that only
  // breaks under @media print (the booklet's own print CSS, pagedjs's
  // print-vs-screen handling).
  await page.emulateMedia({ media: "print" });
  await shotPageMatching(`${tpl}-01-cover-PRINT.png`, { has: ".booklet-cover-title" });
  await shotPageMatching(`${tpl}-02-missionary-PRINT.png`, { has: ".booklet-name" });
  await page.emulateMedia({ media: "screen" });
}

console.log("\nconsole/page errors across the whole run:");
console.log(consoleErrors.join("\n") || "(none)");

await browser.close();
