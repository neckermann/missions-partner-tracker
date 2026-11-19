import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Phase 3b of the UX-rebuild plan: PublicTripApplication.jsx had zero prior
// e2e coverage, and this phase restructured it onto the Wizard shell's 3
// steps -- real regression test, not thrown away. publicTripDiscovery
// defaults off and the id-addressed route 404s without it (see
// backend/src/routes/publicTrips.js's own GET /:id), so it's turned on
// for this file only, same merge-current-settings pattern as
// public-subscribe.spec.js (a blind partial PUT wipes other specs'
// feature toggles, since the backend route replaces the whole column).
async function mergeFeatures(page, patch) {
  const current = await page.request.get("/api/settings");
  const existing = (await current.json()).enabledFeatures || {};
  await page.request.put("/api/settings", { data: { enabledFeatures: { ...existing, ...patch } } });
}

test.describe.configure({ mode: "serial" });
test.describe("Public trip application wizard", () => {
  let tripId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await mergeFeatures(page, { trips: true, publicTripDiscovery: true, publicDirectory: true });

    const partnersRes = await page.request.get("/api/partners");
    const partners = await partnersRes.json();
    const partnerId = (partners.partners || partners)[0]?.id;
    expect(partnerId, "expected at least one seeded partner").toBeTruthy();

    const tripRes = await page.request.post("/api/trips", {
      data: {
        partnerId,
        status: "accepting_applications",
        isPublic: true,
        type: "Construction",
        startDate: "2027-07-01",
        endDate: "2027-07-10",
        applicationQuestions: [{ id: "why", label: "Why do you want to go?", type: "textarea", required: true }],
      },
    });
    expect(tripRes.ok()).toBeTruthy();
    tripId = (await tripRes.json()).id;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    if (tripId) await page.request.delete(`/api/trips/${tripId}`);
    await mergeFeatures(page, { publicTripDiscovery: false });
    await context.close();
  });

  test("walks all 3 steps, validates the required custom question, and submits", async ({ page }) => {
    await page.goto(`/apply/${tripId}`);

    // Step 1: Your info. Seeded demo data sets ChurchSettings.
    // requireDateOfBirth true specifically so a demo visitor exercises
    // this validation (see prisma/seed.js's own comment) -- Next is
    // correctly blocked without it, same as the required-custom-question
    // check on step 3 below.
    await expect(page.getByText("1. Your info")).toBeVisible();
    await page.getByLabel("First name").fill("Jordan");
    await page.getByLabel("Last name").fill("Rivera");
    await page.getByLabel("Email").fill("jordan.rivera@example.test");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert")).toContainText(/date of birth/i);
    await page.getByLabel(/Date of birth/).fill("1995-06-15");
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: Address & contacts -- default ChurchSettings collects both,
    // so real fields should render, not the "nothing needed" fallback.
    // Wait for the step-2-only body text, not just the step label (every
    // step's label renders in the step bar regardless of which is active).
    await expect(page.getByText("Emergency contact")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3: Trip questions. This trip's full question list is the
    // church-wide tripApplicationTemplate (seeded, several required
    // yes/no selects) layered with this trip's own one custom question
    // -- not just the custom one -- so Finish is blocked until every
    // required question across both layers is answered, not only mine.
    await expect(page.getByText("3. Trip questions")).toBeVisible();
    await expect(page.getByText("Why do you want to go?")).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("alert")).toContainText(/is required/);

    for (const select of await page.locator("select").all()) {
      await select.selectOption({ label: "Yes" });
    }
    await page.getByLabel(/Why do you want to go/).fill("Excited to serve alongside the team.");
    await page.getByRole("button", { name: "Finish" }).click();

    await expect(page.getByText("Thanks! Your application has been submitted.")).toBeVisible();
  });
});
