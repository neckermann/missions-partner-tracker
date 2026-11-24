import { test, expect } from "@playwright/test";
import { login, createAccount, createAccountUnsignedIn, totpCode } from "./helpers.js";

// The church-wide two-factor requirement (#385), as people meet it: an admin who hasn't enrolled
// can't turn it on, and is told why; with it on, an account that hasn't enrolled (an editor, a
// guest: no role is special) is sent through enrolment at sign-in and then lets in; and a session
// open when it is turned on ends at the next click. It changes a church setting, so it is one of
// the specs that run serially (FEATURE_SPECS in playwright.config.js).
//
// Only an enrolled admin may turn it on, and while it is on the shared e2e admin (which has not
// enrolled, and must not: every other spec signs in with its password alone) is refused. So the
// spec uses an admin of its own that has enrolled, and always turns the requirement back off
// before anything else touches the shared admin again.
test.describe.configure({ mode: "serial" });

test.describe("Two-factor requirement", () => {
  let adminContext;
  let admin; // the shared e2e admin: not enrolled
  let enrolledAdminContext;
  let enrolledAdmin; // this spec's own admin: enrolled, so it can turn the requirement on and off
  let originalRequirement;
  let tripId;
  const accountIds = [];

  const setRequirement = (value) =>
    enrolledAdmin.request.put("/api/settings", { data: { requireTwoFactor: value } });

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    originalRequirement = (await (await admin.request.get("/api/settings")).json()).requireTwoFactor === true;
    expect(originalRequirement, "the suite expects the requirement off to start").toBe(false);

    const helper = await createAccount(browser, admin, { role: "admin", suffix: "2fa", enrolled: true });
    accountIds.push(helper.user.id);
    enrolledAdminContext = await browser.newContext({ storageState: helper.storageState });
    enrolledAdmin = await enrolledAdminContext.newPage();
  });

  test.afterAll(async () => {
    // Off first: the shared admin is refused while it is on.
    await setRequirement(false);
    for (const id of accountIds) await admin.request.delete(`/api/users/${id}`);
    if (tripId) await admin.request.delete(`/api/trips/${tripId}`);
    await enrolledAdminContext.close();
    await adminContext.close();
  });

  // What a person does at the enrolment screen: read the secret, type the code, confirm.
  async function enrolThroughTheScreen(page) {
    await page.waitForSelector("code");
    const secret = (await page.locator("code").first().innerText()).trim();
    await page
      .getByLabel(/6-digit code|code/i)
      .first()
      .fill(await totpCode(secret));
    await page.getByRole("button", { name: /Confirm/ }).click();
    await page.waitForURL(/\/admin/);
  }

  async function signInThroughTheScreen(page, { email, password }) {
    await page.goto("/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
  }

  test("an admin who hasn't set up two-factor can't turn the requirement on, and is told why", async () => {
    await admin.goto("/admin/settings/users");
    await expect(admin.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Require it for everyone" })).toBeDisabled();
    await expect(admin.getByText(/Set up two-factor on your own account first/)).toBeVisible();

    // The server refuses too, whatever the page does.
    const refused = await admin.request.put("/api/settings", { data: { requireTwoFactor: true } });
    expect(refused.status()).toBe(400);
  });

  test("with it on, an editor who hasn't enrolled is sent through enrolment at sign-in, then let in", async ({
    page,
  }) => {
    const editor = await createAccountUnsignedIn(admin, { role: "editor", suffix: "must-enrol" });
    accountIds.push(editor.user.id);

    // Off: a password alone signs them in, as it always did.
    await signInThroughTheScreen(page, editor);
    await page.waitForURL(/\/admin/);
    await page.context().clearCookies();

    expect((await setRequirement(true)).ok()).toBeTruthy();
    await signInThroughTheScreen(page, editor);
    await expect(page.getByText(/Enter this code manually|scan/i).first()).toBeVisible();
    await enrolThroughTheScreen(page);
    await expect(page).toHaveURL(/\/admin/);
  });

  test("a guest is held to the same rule as an editor", async ({ page }) => {
    // Set up with the requirement off (the shared admin is refused while it is on), then turn it on.
    const partners = await (
      await enrolledAdmin.request.get("/api/partners?restricted=false&archived=false")
    ).json();
    const partnerId = (Array.isArray(partners) ? partners : partners.partners)[0].id;
    await setRequirement(false);
    const trip = await admin.request.post("/api/trips", {
      data: {
        partnerId,
        status: "accepting_applications",
        isPublic: false,
        type: "Construction",
        startDate: "2027-12-01",
        endDate: "2027-12-10",
      },
    });
    expect(trip.ok(), "creating a trip").toBeTruthy();
    tripId = (await trip.json()).id;
    const guest = await createAccountUnsignedIn(admin, {
      role: "guest",
      suffix: "must-enrol",
      tripAccess: [{ tripId }],
    });
    accountIds.push(guest.user.id);
    await setRequirement(true);

    await signInThroughTheScreen(page, guest);
    await expect(page.getByText(/Enter this code manually|scan/i).first()).toBeVisible();
    await enrolThroughTheScreen(page);
    await expect(page).toHaveURL(/\/admin/);
  });

  test("a session open when it is turned on ends at the next click, back at sign-in", async ({ page }) => {
    await setRequirement(false);
    const editor = await createAccountUnsignedIn(admin, { role: "editor", suffix: "open-session" });
    accountIds.push(editor.user.id);

    await signInThroughTheScreen(page, editor);
    await page.waitForURL(/\/admin/);

    expect((await setRequirement(true)).ok()).toBeTruthy();
    // The page's own background requests (the notification bell) are refused first and send it
    // back to sign-in; if none has fired yet, a click does.
    await page
      .getByRole("link", { name: /Prayer Requests/ })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await page.waitForURL(/\/login/);
    // Back at sign-in; signing in again takes them through enrolment.
    await page.fill('input[type="email"]', editor.email);
    await page.fill('input[type="password"]', editor.password);
    await page.click('button[type="submit"]');
    await expect(page.getByText(/Enter this code manually|scan/i).first()).toBeVisible();

    await setRequirement(false);
  });
});
