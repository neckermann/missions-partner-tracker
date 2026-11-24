import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Phase 3b of the UX-rebuild plan: PublicTripApplication.jsx had zero prior
// e2e coverage, and this phase restructured it onto the Wizard shell's 3
// steps -- real regression test, not thrown away. publicTripDiscovery
// defaults off and the id-addressed route 404s without it (see
// backend/src/routes/publicTrips.js's own GET /:id), so it's turned on
// for this file only, through setFeatures/restoreFeatures (helpers.js), which merge
// into the stored flags (a blind partial PUT wipes other specs' toggles, since the backend
// route replaces the whole column) and put back what they changed. This is one of the six
// specs that change flags; they run together in their own serial Playwright project
// (playwright.config.js).
let previousFeatures;

test.describe.configure({ mode: "serial" });
test.describe("Public trip application wizard", () => {
  let tripId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    previousFeatures = await setFeatures(page.request, {
      trips: true,
      publicTripDiscovery: true,
      publicDirectory: true,
    });

    // restricted=false&archived=false -- a restricted partner's trip is
    // never publicly discoverable regardless of isPublic (see
    // AdminTrips.jsx's own "Restricted partner" note), and an archived
    // partner's own trip fares no better publicly, so an unfiltered
    // partners[0] landing on either makes every step of this wizard
    // unreachable -- same class of fixture fragility helpers.js's own
    // firstSelectablePartner already guards against.
    const partnersRes = await page.request.get("/api/partners?restricted=false&archived=false");
    const partners = await partnersRes.json();
    const partnerId = (partners.partners || partners)[0]?.id;
    expect(partnerId, "expected at least one seeded non-restricted, non-archived partner").toBeTruthy();

    const tripRes = await page.request.post("/api/trips", {
      data: {
        partnerId,
        status: "accepting_applications",
        isPublic: true,
        type: "Construction",
        startDate: "2027-07-01",
        endDate: "2027-07-10",
        applicationQuestions: [
          { id: "why", label: "Why do you want to go?", type: "textarea", required: true },
        ],
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
    await restoreFeatures(page.request, previousFeatures);
    await context.close();
  });

  test("walks all 3 steps, validates the required custom question, and submits", async ({ page }) => {
    await page.goto(`/apply/${tripId}`);

    // Step 1: Your info. Date of birth is always collected and always
    // required now (no settings gate it) -- Next is correctly blocked
    // without it, same as the required-custom-question check on step 3
    // below.
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
    // This applicant is an adult (DOB above computes well over 18 as of
    // the trip's 2027-07-01 start) -- the Parent/guardian section must not
    // appear at all for them.
    await expect(page.getByText("Emergency contact")).toBeVisible();
    await expect(page.getByText(/Parent\/guardian/)).toHaveCount(0);
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

  test("a minor applicant gets a required Parent/guardian step, enforced on both steps 1 and 2", async ({
    page,
  }) => {
    await page.goto(`/apply/${tripId}`);

    await expect(page.getByText("1. Your info")).toBeVisible();
    await page.getByLabel("First name").fill("Avery");
    await page.getByLabel("Last name").fill("Chen");
    await page.getByLabel("Email").fill("avery.chen@example.test");
    // Age 15 as of this trip's 2027-07-01 startDate -- clearly a minor.
    await page.getByLabel(/Date of birth/).fill("2012-01-01");
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: the Parent/guardian section must appear (computed from the
    // DOB just entered, not any per-trip/church-wide setting), and Next
    // must be blocked until it's filled in.
    await expect(page.getByText(/Parent\/guardian \(required/)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert")).toContainText(/parent\/guardian/i);

    await page.getByLabel("First Name", { exact: true }).nth(1).fill("Jamie");
    await page.getByLabel("Last Name", { exact: true }).nth(1).fill("Chen");
    await page.getByLabel("Relationship").fill("Mother");
    await page.getByLabel("Phone", { exact: true }).nth(1).fill("555-0100");
    // Emergency contact's own email field is labeled "Email (optional)",
    // not an exact match for "Email" -- the parent/guardian one (plain
    // "Email") is the only exact match, so no .nth() needed here.
    await page.getByLabel("Email", { exact: true }).fill("jamie.chen@example.test");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("3. Trip questions")).toBeVisible();
    for (const select of await page.locator("select").all()) {
      await select.selectOption({ label: "Yes" });
    }
    await page.getByLabel(/Why do you want to go/).fill("Excited to serve alongside the team.");
    await page.getByRole("button", { name: "Finish" }).click();

    await expect(page.getByText("Thanks! Your application has been submitted.")).toBeVisible();
  });
});
