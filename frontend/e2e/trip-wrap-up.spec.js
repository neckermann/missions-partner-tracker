import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// The Wrap up trip wizard as a person uses it: from a trip whose dates have passed, step
// through it, and the trip is completed with its debrief on the overview. It makes its own
// trip (on a seeded partner) and deletes it afterwards.
test.describe("Wrap up trip", () => {
  let adminContext;
  let admin;
  let tripId;
  const tripName = `E2E wrap-up ${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    const res = await admin.request.get("/api/partners?restricted=false&archived=false");
    const partners = await res.json();
    const partner = (Array.isArray(partners) ? partners : partners.partners)[0];
    expect(partner, "expected a seeded non-restricted, non-archived partner").toBeTruthy();
    const trip = await admin.request.post("/api/trips", {
      data: {
        partnerId: partner.id,
        name: tripName,
        status: "closed",
        isPublic: false,
        type: "Construction",
        startDate: "2026-01-05",
        endDate: "2026-01-15",
      },
    });
    expect(trip.ok(), "creating the trip").toBeTruthy();
    tripId = (await trip.json()).id;
  });

  test.afterAll(async () => {
    if (tripId) await admin.request.delete(`/api/trips/${tripId}`);
    await adminContext.close();
  });

  test("walks through the steps, completes the trip, and shows the debrief", async () => {
    await admin.goto(`/admin/trips/${tripId}`);
    await expect(admin.getByRole("heading", { name: tripName })).toBeVisible();
    await admin.getByRole("link", { name: "Wrap up trip" }).click();
    await expect(admin.getByRole("heading", { name: "Wrap up this trip" })).toBeVisible();

    // 1. What happened: confirm the dates.
    await expect(admin.getByLabel("Actual end")).toHaveValue("2026-01-15");
    await admin.getByRole("button", { name: "Next" }).click();

    // 2. Debrief.
    await admin.getByLabel("What did the team do?").fill("Built the school roof");
    await admin.getByLabel("What does the partner need next?").fill("More cement");
    await admin.getByRole("button", { name: "Next" }).click();

    // Then skip through the rest (a follow-up appears only when the contact log is on).
    for (let i = 0; i < 4; i += 1) {
      const skip = admin.getByRole("button", { name: "Skip" });
      if (await skip.isVisible()) await skip.click();
    }
    await admin.getByRole("button", { name: "Finish" }).click();
    await expect(admin.getByText("Trip wrapped up")).toBeVisible();

    await admin.getByRole("link", { name: "Back to the trip" }).click();
    const debrief = admin.locator("#trip-debrief");
    await expect(debrief.getByText("Built the school roof")).toBeVisible();
    await expect(debrief.getByText("More cement")).toBeVisible();
    // It is completed now, so the button to wrap it up is gone.
    await expect(admin.getByRole("link", { name: "Wrap up trip" })).toHaveCount(0);
    const saved = await (await admin.request.get(`/api/trips/${tripId}`)).json();
    expect(saved.status).toBe("completed");
    expect(saved.wrappedUpAt).toBeTruthy();
  });
});
