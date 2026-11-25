import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Support preferences as people use them: an admin edits the church's menu in Settings (an
// example set from an empty menu, or an option of their own), staff record a partner's choices
// on the partner's page, and the report lists them. The route tests cover the rules one
// endpoint at a time; this drives the screens. It turns Care teams and Support preferences on,
// so it is one of the specs that change settings (FEATURE_SPECS in playwright.config.js:
// serial, restores). Only partner-and-option data this spec created is removed afterwards; an
// example set is removed only if the menu was empty when the spec started.
test.describe.configure({ mode: "serial" });

test.describe("Support preferences", () => {
  let adminContext;
  let admin;
  let previousFeatures;
  let startedEmpty;
  let partner;
  const label = `E2E pick-up ${Date.now()}`;
  const note = `E2E note ${Date.now()}`;
  const group = "E2E Support";

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    previousFeatures = await setFeatures(admin.request, { careTeam: true, supportPreferences: true });
    const options = await (await admin.request.get("/api/support-preferences/options")).json();
    startedEmpty = options.length === 0;
    const res = await admin.request.get("/api/partners?restricted=false&archived=false");
    const partners = await res.json();
    partner = (Array.isArray(partners) ? partners : partners.partners)[0];
    expect(partner, "expected a seeded non-restricted, non-archived partner").toBeTruthy();
  });

  test.afterAll(async () => {
    const options = await (await admin.request.get("/api/support-preferences/options")).json();
    for (const o of options) {
      if (startedEmpty || o.label === label) {
        await admin.request.delete(`/api/support-preferences/options/${o.id}`);
      }
    }
    await restoreFeatures(admin.request, previousFeatures);
    await adminContext.close();
  });

  test("an example menu pack can be imported (pasted) and then edited", async () => {
    test.skip(
      !startedEmpty,
      "the menu already had options, so importing would add to a menu the spec doesn't own"
    );
    const pack = fs.readFileSync(
      new URL("../../examples/template-packs/support-menu-example.json", import.meta.url),
      "utf8"
    );
    await admin.goto("/admin/settings/support-preferences");
    await expect(admin.getByText(/Import an example menu/)).toBeVisible();
    await admin.getByRole("button", { name: "Import a menu…" }).click();
    await admin.getByLabel(/paste it here/).fill(pack);
    await admin.getByRole("button", { name: "Check this pack" }).click();
    await expect(admin.getByText(/support options, in \d+ groups/)).toBeVisible();
    await admin.getByRole("button", { name: "Import", exact: true }).click();
    await expect(admin.getByText(/Added \d+ support options/)).toBeVisible();
    await admin.getByRole("button", { name: "Done" }).click();
    await expect(admin.getByText("Airport pick-up")).toBeVisible();
  });

  test("an admin adds an option of their own to the menu", async () => {
    await admin.goto("/admin/settings/support-preferences");
    await admin.getByRole("button", { name: "+ Add an option" }).click();
    await admin.getByLabel("Group").fill(group);
    await admin.getByLabel("What it says").fill(label);
    await admin.getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText(label)).toBeVisible();
  });

  test("staff record a partner's choices on their page, and they show on the card", async () => {
    await admin.goto(`/admin/partners/${partner.id}`);
    const card = admin.locator("#section-support-preferences");
    await expect(card.getByRole("heading", { name: "Support Preferences" })).toBeVisible();
    await card.getByRole("button", { name: /^(\+ Record|Edit)$/ }).click();
    await admin.getByLabel(label, { exact: true }).check();
    await admin.getByLabel(`Note for ${label}`).fill(note);
    await admin.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText(/preferences? recorded/)).toBeVisible();
    await card.getByRole("button", { name: "View all →" }).click();
    const details = admin.getByRole("dialog", { name: "Support Preferences" });
    await expect(details.getByText(note)).toBeVisible();
    await expect(details.locator("ul li", { hasText: label })).toBeVisible();
  });

  test("the printable menu lists the active options", async () => {
    await admin.goto("/admin/settings/support-preferences");
    await admin.getByRole("link", { name: "Print menu" }).click();
    await expect(admin.getByRole("heading", { name: "Printable menu" })).toBeVisible();
    await expect(admin.locator(".support-menu-sheet").getByText(label)).toBeVisible();
    await expect(admin.getByRole("button", { name: "Print" })).toBeVisible();
  });

  test("the report lists the partner and what they chose", async () => {
    const res = await admin.request.get("/api/reports/support-preferences");
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    const row = body.rows.find((r) => r.option === label);
    expect(row, "the report should list the option we just recorded").toBeTruthy();
    expect(row.note).toBe(note);
  });

  test("turning the feature off hides the card and keeps the data", async () => {
    await setFeatures(admin.request, { supportPreferences: false });
    await admin.goto(`/admin/partners/${partner.id}`);
    await expect(admin.locator("#section-support-preferences")).toHaveCount(0);
    await setFeatures(admin.request, { supportPreferences: true });
    await admin.goto(`/admin/partners/${partner.id}`);
    await expect(
      admin.locator("#section-support-preferences").getByText(/preferences? recorded/)
    ).toBeVisible();
  });
});
