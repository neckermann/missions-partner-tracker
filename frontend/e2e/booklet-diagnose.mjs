// Dev-only diagnostic: verifies the booklet fixes (friendly photo clip,
// print-view images/pagination, simplified back cover) by actually
// rendering the page and looking, rather than reasoning about CSS in the
// abstract.
//
//   node e2e/booklet-diagnose.mjs [outDir]

import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:4000";
const EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";
const outDir = process.argv[2] || ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/);

await page.goto(`${BASE}/admin/booklet`);

// No `value` attribute on the radios (React controls them via
// checked/onChange alone); the label text is unique per template and the
// input is nested inside its <label>, so clicking the text toggles it via
// normal label forwarding.
const TEMPLATE_LABELS = {
  friendly: "Friendly",
  classic: "Classic",
  modern: "Modern",
  traditional: "Traditional",
  keepsake: "Keepsake",
  portfolio: "Portfolio",
};
async function selectTemplate(tpl) {
  await page.getByText(TEMPLATE_LABELS[tpl], { exact: true }).click();
  await page.locator(".booklet-preview").waitFor();
}

// --- 1. Friendly template: is the header-photo overlap still clipped? ---
await selectTemplate("friendly");
const friendlyPhotoPage = page
  .locator(".booklet-preview section")
  .filter({ has: page.locator(".booklet-photo") })
  .first();
await friendlyPhotoPage.screenshot({ path: path.join(outDir, "1-friendly-header.png") });

const photoBox = await page.locator(".booklet-preview .booklet-photo").first().boundingBox();
const pageBox = await friendlyPhotoPage.boundingBox();
console.log(
  `[friendly] photo top=${photoBox.y.toFixed(1)} page top=${pageBox.y.toFixed(1)} ` +
    `-> photo starts ${(photoBox.y - pageBox.y).toFixed(1)}px into the page ` +
    `(negative would mean still clipped above the page edge)`
);

// --- 2. Back cover: logo, name, address, phone, website -- no tagline/about ---
const backCover = page.locator(".booklet-preview .booklet-back-cover").first();
await backCover.scrollIntoViewIfNeeded();
await backCover.screenshot({ path: path.join(outDir, "2-back-cover-friendly.png") });
const backCoverText = await backCover.innerText();
console.log("[back cover] friendly text:\n" + backCoverText);

for (const tpl of ["classic", "modern", "traditional", "keepsake", "portfolio"]) {
  await selectTemplate(tpl);
  const cover = page.locator(".booklet-preview .booklet-back-cover").first();
  await cover.scrollIntoViewIfNeeded();
  await cover.screenshot({ path: path.join(outDir, `2-back-cover-${tpl}.png`) });
}
await selectTemplate("classic");

// --- 3. Print path: does window.print() show paginated content with real images? ---
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(500);

const printDiag = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".booklet-preview img")];
  return {
    pageCount: document.querySelectorAll(".booklet-preview section").length,
    imgCount: imgs.length,
    imgsWithZeroWidth: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    sidebarVisible: getComputedStyle(document.querySelector(".admin-sidebar") || document.body).visibility,
    previewVisible: getComputedStyle(document.querySelector(".booklet-preview")).visibility,
  };
});
console.log("[print media]", JSON.stringify(printDiag, null, 2));

const printPhotoPage = page
  .locator(".booklet-preview section")
  .filter({ has: page.locator(".booklet-photo") })
  .first();
if (await printPhotoPage.count()) {
  await printPhotoPage.screenshot({ path: path.join(outDir, "3-print-media-photopage.png") });
}
await page
  .locator(".booklet-preview .booklet-cover")
  .first()
  .screenshot({
    path: path.join(outDir, "3-print-media-cover.png"),
  });

console.log("\nconsole errors seen during the whole run:");
console.log(consoleErrors.join("\n") || "(none)");

await browser.close();
