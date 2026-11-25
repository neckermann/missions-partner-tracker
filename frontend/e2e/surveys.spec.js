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

  test("a survey from the Annual update template proposes changes that staff approve", async () => {
    const stamp = Date.now();
    const created = await admin.request.post("/api/partners", {
      data: {
        kind: "missionary",
        displayName: `E2E survey partner ${stamp}`,
        adults: [{ firstName: "Pat", lastName: "Doe", phone1: "(111) 111-1111", isPrimaryContact: true }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const person = await created.json();
    const annual = `E2E annual ${stamp}`;

    await admin.goto("/admin/settings/surveys");
    await admin.getByRole("button", { name: "+ New survey" }).click();
    await admin.getByLabel("Start from").selectOption("annual-update");
    await admin.getByLabel(/^Title/).fill(annual);
    await admin.getByRole("button", { name: "Create" }).click();
    await expect(admin.getByRole("heading", { name: annual })).toBeVisible();
    await expect(admin.getByLabel("Question 1", { exact: true })).toHaveValue(
      "Best phone number to reach you"
    );
    await expect(admin.getByLabel("Part of the record for question 1")).toHaveValue("primaryPhone");
    await admin.getByRole("button", { name: "Open survey" }).click();
    await expect(admin.getByText("The survey is open.")).toBeVisible();

    await admin.goto(`/admin/partners/${person.id}`);
    await admin
      .locator("#section-surveys")
      .getByRole("button", { name: new RegExp(`${annual} · not sent`) })
      .click();
    await admin.getByRole("textbox", { name: "Best phone number to reach you" }).fill("(337) 555-0100");
    await admin.getByRole("button", { name: "Save as answered" }).click();
    await expect(
      admin.locator("#section-surveys").getByRole("button", { name: new RegExp(`${annual} · answered`) })
    ).toBeVisible();

    await admin.goto("/admin/survey-updates");
    const row = admin.getByRole("row", { name: new RegExp(`E2E survey partner ${stamp}`) });
    await expect(row.getByText("(337) 555-0100")).toBeVisible();
    await expect(row.getByText("(111) 111-1111")).toBeVisible();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toHaveCount(0);

    const adults = await (await admin.request.get(`/api/adults?partnerId=${person.id}`)).json();
    expect(adults[0].phone1).toBe("(337) 555-0100");
    await admin.getByRole("tab", { name: "Decided" }).click();
    await expect(admin.getByRole("row", { name: new RegExp(`E2E survey partner ${stamp}`) })).toBeVisible();

    const surveys = await (await admin.request.get("/api/surveys")).json();
    for (const sv of surveys.surveys)
      if (sv.title === annual) await admin.request.delete(`/api/surveys/${sv.id}`);
    await admin.request.delete(`/api/partners/${person.id}`);
  });

  test("turning the feature off hides the card and the Settings page", async () => {
    await setFeatures(admin.request, { surveys: false });
    await admin.goto(`/admin/partners/${partner.id}`);
    await expect(admin.locator("#section-surveys")).toHaveCount(0);
    expect((await admin.request.get("/api/surveys")).status()).toBe(404);
    await setFeatures(admin.request, { surveys: true });
  });
});
