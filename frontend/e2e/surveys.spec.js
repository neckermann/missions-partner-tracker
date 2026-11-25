import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// Partner surveys as people use them: an admin builds and opens a survey in Settings, and staff
// fill it in for a partner from that partner's page. (The partner's emailed link is covered by the
// route and component tests: sending needs real email.) Turns Care teams and Surveys on, and
// cleans up the survey it makes.
test.describe.configure({ mode: "serial" });

test.describe("Partner surveys", () => {
  let adminContext;
  let admin;
  let previousFeatures;
  let partner;
  const title = `E2E check-in ${Date.now()}`;
  const question = "How can we pray for you this week?";

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    previousFeatures = await setFeatures(admin.request, { careTeam: true, surveys: true });
    const res = await admin.request.get("/api/partners?restricted=false&archived=false");
    const partners = await res.json();
    partner = (Array.isArray(partners) ? partners : partners.partners)[0];
    expect(partner, "expected a seeded non-restricted, non-archived partner").toBeTruthy();
  });

  test.afterAll(async () => {
    const surveys = await (await admin.request.get("/api/surveys")).json();
    for (const s of surveys.surveys) {
      if (s.title === title) await admin.request.delete(`/api/surveys/${s.id}`);
    }
    await restoreFeatures(admin.request, previousFeatures);
    await adminContext.close();
  });

  test("an admin builds a survey and opens it", async () => {
    await admin.goto("/admin/settings/surveys");
    await admin.getByRole("button", { name: "+ New survey" }).click();
    await admin.getByLabel("Title").fill(title);
    await admin.getByRole("button", { name: "Create" }).click();
    await expect(admin.getByRole("heading", { name: title })).toBeVisible();

    await admin.getByRole("button", { name: "+ Add question" }).click();
    await admin.getByLabel("Question 1", { exact: true }).fill(question);
    await admin.getByRole("button", { name: "Save questions" }).click();
    await expect(admin.getByText("Questions saved.")).toBeVisible();

    await admin.getByRole("button", { name: "Open survey" }).click();
    await expect(admin.getByText("The survey is open.")).toBeVisible();
  });

  test("staff fill it in for a partner, and it shows on their page", async () => {
    await admin.goto(`/admin/partners/${partner.id}`);
    const card = admin.locator("#section-surveys");
    await card.getByRole("button", { name: new RegExp(`${title} · not sent`) }).click();
    await admin.getByRole("textbox", { name: question }).fill("Our visa renewal");
    await admin.getByRole("button", { name: "Save as answered" }).click();
    await expect(card.getByRole("button", { name: new RegExp(`${title} · answered`) })).toBeVisible();
    await card.getByRole("button", { name: new RegExp(`${title} · answered`) }).click();
    await expect(admin.getByText("Our visa renewal")).toBeVisible();
  });

  test("turning the feature off hides the card and the Settings page", async () => {
    await setFeatures(admin.request, { surveys: false });
    await admin.goto(`/admin/partners/${partner.id}`);
    await expect(admin.locator("#section-surveys")).toHaveCount(0);
    expect((await admin.request.get("/api/surveys")).status()).toBe(404);
    await setFeatures(admin.request, { surveys: true });
  });
});
