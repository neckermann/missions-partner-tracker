import { test, expect } from "@playwright/test";
import { login, createAccountUnsignedIn, submitLoginForm } from "./helpers.js";

// Passkeys as a second sign-in factor, driven in a real browser with a virtual authenticator
// (Chrome's WebAuthn test device, over CDP): add one on My account, sign out, sign in with the
// password and then the passkey, and remove it again.
test.describe("Passkeys", () => {
  let adminContext;
  let admin;
  let account;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    account = await createAccountUnsignedIn(admin, { role: "editor", suffix: "passkey" });
  });

  test.afterAll(async () => {
    if (account) await admin.request.delete(`/api/users/${account.user.id}`);
    await adminContext.close();
  });

  test("add a passkey, sign in with it, and remove it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await login(page, account.email, account.password);
    await page.goto("/admin/account");
    await page.getByLabel("Name (optional)").fill("Test device");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();
    await expect(page.getByText("Test device")).toBeVisible();
    await expect(page.getByText("Enabled with passkeys")).toBeVisible();

    // Sign out, then back in: password, then the passkey. The sign-in page also offers the browser's
    // own passkey list, which would pick this passkey up by itself, so the device is told to wait
    // for a person until the password step is done.
    await page.getByTitle("Log out").click();
    await page.waitForURL(/\/login|\/$/);
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
    await page.goto("/login");
    await submitLoginForm(page, account.email, account.password);
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
    await page.getByRole("button", { name: "Use a passkey" }).click();
    await page.waitForURL(/\/admin/);

    // Sign out again and open the sign-in page: with a passkey on the device, the browser's own list
    // signs in with it alone, no email or password typed.
    await page.getByTitle("Log out").click();
    await page.waitForURL(/\/login|\/$/);
    await page.goto("/login");
    await page.waitForURL(/\/admin/);

    // Remove it with the password: two-factor goes back to off.
    await page.goto("/admin/account");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByLabel("Current Password").fill(account.password);
    await page.getByRole("button", { name: "Remove passkey" }).click();
    await expect(page.getByText("Passkey removed.")).toBeVisible();
    await expect(page.getByText("Disabled")).toBeVisible();
    await context.close();
  });

  test("a new account's setup link: a passkey on this device, signed in straight away", async ({
    browser,
  }) => {
    // An account with no password yet, and the link an administrator would hand over (email is off in CI).
    const email = `e2e-newaccount-${Date.now()}@example.test`;
    const created = await admin.request.post("/api/users", {
      data: { email, firstName: "Dana", lastName: "Newcomer", role: "editor", sendWelcomeEmail: false },
    });
    expect(created.ok()).toBeTruthy();
    const user = await created.json();
    try {
      const linkRes = await admin.request.post(`/api/users/${user.id}/setup-link`);
      const { manualSetupUrl } = await linkRes.json();
      expect(manualSetupUrl).toContain("/set-password?token=");

      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });

      await page.goto(new URL(manualSetupUrl).pathname + new URL(manualSetupUrl).search);
      await expect(page.getByRole("heading", { name: "Welcome, Dana" })).toBeVisible();
      await expect(page.getByText("Where will you mostly sign in?")).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Create a passkey on this device" }).click();
      // Signed in straight from the link: no separate sign-in step.
      await page.waitForURL(/\/admin/);
      await expect(page.locator(".admin-sidebar")).toBeVisible();

      // The link is spent.
      await page.goto(new URL(manualSetupUrl).pathname + new URL(manualSetupUrl).search);
      await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
      await context.close();
    } finally {
      await admin.request.delete(`/api/users/${user.id}`);
    }
  });
});
