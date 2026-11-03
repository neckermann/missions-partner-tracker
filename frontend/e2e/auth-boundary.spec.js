import { test, expect } from "@playwright/test";
import { generate as generateTotp } from "otplib";
import { login, ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers.js";

// Logging in IS the security boundary in this app: any account that can sign
// in reads every partner's full record, including restricted partners' exact
// locations and contact details (see ADMIN_GUIDE.md § Who can see what).
// Roles only decide who can change things.
//
// That makes these the flows most worth testing, and until now they had no
// browser coverage at all -- not MFA, not user management, not first-run
// setup, and only indirect coverage of role gating. The route tests check the
// API's gates; these check that the UI enforces the same thing, which is what
// a person actually interacts with.

const PASSWORD = "E2eBoundaryPassword123!";

// Creates a user through the API while signed in as an admin.
async function createUser(page, { role, suffix }) {
  const email = `e2e-${suffix}-${Date.now()}@example.test`;
  const res = await page.request.post("/api/users", {
    data: { email, name: `E2E ${role}`, role, password: PASSWORD },
  });
  expect(res.status(), `creating a ${role} should succeed`).toBe(201);
  return { ...(await res.json()), email };
}

async function signInAs(page, email, password) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// The account page has two "Current Password" fields: one for changing the
// password, one for disabling two-factor. Scope to the section to say which.
function mfaSection(page) {
  return page
    .locator(".admin-section")
    .filter({ has: page.getByRole("heading", { name: "Two-Factor Authentication" }) });
}

test.describe("role gating in the UI", () => {
  test("an editor can read partners but cannot reach Site Administration", async ({ page }) => {
    await login(page);
    const editor = await createUser(page, { role: "editor", suffix: "editor" });

    try {
      await signInAs(page, editor.email, PASSWORD);
      await page.waitForURL(/\/admin/);

      // The documented invariant: reading is not gated by role.
      await page.goto("/admin/partners");
      await expect(page.locator("h2").first()).toBeVisible();
      // toBeVisible retries; locator.count() does not, and would read the
      // table before the fetch that fills it has landed.
      await expect(page.locator("table tbody tr").first(), "an editor sees the partner list").toBeVisible();

      // The admin-only settings area is neither offered nor reachable.
      await expect(page.getByRole("button", { name: /Site Administration/i })).toHaveCount(0);

      await page.goto("/admin/settings/users");
      await expect(page, "an editor is redirected away from user management").toHaveURL(/\/admin$/);
    } finally {
      await login(page);
      await page.request.delete(`/api/users/${editor.id}`);
    }
  });

  test("a viewer can read, and the API refuses their writes", async ({ page }) => {
    await login(page);
    const viewer = await createUser(page, { role: "viewer", suffix: "viewer" });

    try {
      await signInAs(page, viewer.email, PASSWORD);
      await page.waitForURL(/\/admin/);
      await page.goto("/admin/partners");
      await expect(page.locator("h2").first()).toBeVisible();

      // Whatever the UI offers, the gate that matters is the API's.
      const write = await page.request.post("/api/partners", {
        data: { kind: "missionary", displayName: "[route-test] viewer should not create" },
      });
      expect(write.status(), "a viewer's write is refused").toBe(403);
    } finally {
      await login(page);
      await page.request.delete(`/api/users/${viewer.id}`);
    }
  });
});

test.describe("user management", () => {
  test("an admin can create, edit and delete a user through the UI", async ({ page }) => {
    await login(page);

    const email = `e2e-managed-${Date.now()}@example.test`;
    await page.goto("/admin/settings/users/new");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Managed User");
    await page.getByLabel("Role").selectOption("viewer");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.click('button[type="submit"]');

    const row = page.locator("tr", { hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText("viewer");

    // Edit: promote to editor and confirm it sticks.
    await row.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Role").selectOption("editor");
    await page.click('button[type="submit"]');
    await expect(page.locator("tr", { hasText: email })).toContainText("editor");

    // Delete, through the native confirm the page uses.
    page.once("dialog", (d) => d.accept());
    await page.locator("tr", { hasText: email }).getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("tr", { hasText: email })).toHaveCount(0);
  });
});

test.describe("first-run setup", () => {
  test("is closed once an admin exists", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login/);

    // And the server re-checks rather than trusting an earlier status call,
    // so posting directly can't create a second admin either.
    const res = await page.request.post("/api/auth/setup", {
      data: { email: "e2e-second-admin@example.test", password: PASSWORD },
    });
    expect(res.status(), "a second admin cannot be created").toBe(409);
  });
});

test.describe("login redirect for direct links to authenticated files", () => {
  // #124: a cold click on a direct link to a requireAuth-gated route (a
  // GroupMe notification, etc.) with no session used to show bare JSON.
  // Each test gets Playwright's default fresh, cookie-less context.
  test("a direct link with no session redirects to /login and returns to the original path after signing in", async ({
    page,
  }) => {
    await page.goto("/api/newsletters/any-id/download");
    await expect(page).toHaveURL(/\/login\?next=%2Fapi%2Fnewsletters%2Fany-id%2Fdownload/);

    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // The fixture ID doesn't exist, so this 404s -- but a 404 JSON body
    // (not a second /login redirect, not the bare "Authentication
    // required" this issue is about) proves requireAuth let the request
    // through with the fresh session cookie.
    await page.waitForURL(/\/api\/newsletters\/any-id\/download/);
    await expect(page.locator("body")).toContainText("Not found");
  });

  // Open-redirect guard: a crafted ?next= must never be honored.
  for (const malicious of ["https://evil.com", "//evil.com", "/not-an-api-path"]) {
    test(`/login?next=${malicious} falls back to /admin instead of honoring it`, async ({ page }) => {
      await page.goto(`/login?next=${encodeURIComponent(malicious)}`);
      await page.fill('input[type="email"]', ADMIN_EMAIL);
      await page.fill('input[type="password"]', ADMIN_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/admin$/);
    });
  }
});

test.describe("two-factor authentication", () => {
  // Enrolls a throwaway user rather than the shared admin. An earlier version
  // of this test enabled MFA on the admin every other spec signs in with, and
  // when it failed before reaching its cleanup it left that account needing a
  // code nobody had -- every later test then hung at the challenge screen. A
  // dedicated user means the worst case is a leftover row.
  test("enrolls, blocks a replayed code, signs in, and disables", async ({ page }) => {
    test.setTimeout(120_000); // includes one wait for the TOTP window to roll

    await login(page);
    const user = await createUser(page, { role: "editor", suffix: "mfa" });

    try {
      await signInAs(page, user.email, PASSWORD);
      await page.waitForURL(/\/admin/);
      await page.goto("/admin/account");
      await mfaSection(page).getByRole("button", { name: "Enable Two-Factor Authentication" }).click();

      // The page prints the secret for anyone who cannot scan the QR code,
      // which is also how this test gets hold of it.
      //
      // Asserted before reading so a failure says what is wrong. Enrollment
      // is the only thing that touches FIELD_ENCRYPTION_KEY, and when that
      // key doesn't decode to 32 bytes the request 500s and no secret ever
      // appears -- which otherwise shows up as an unexplained timeout two
      // minutes later. CI shipped a 31-byte key for weeks on exactly this.
      const secretEl = mfaSection(page).locator("code").first();
      await expect(
        secretEl,
        "enrollment should show a secret -- if this times out, check FIELD_ENCRYPTION_KEY decodes to 32 bytes"
      ).toBeVisible();

      const secret = (await secretEl.innerText()).trim();
      expect(secret.length, "a TOTP secret is shown").toBeGreaterThan(10);

      const enrollCode = await generateTotp({ secret });
      await page.getByLabel(/6-digit code/i).fill(enrollCode);
      await page.getByRole("button", { name: "Confirm & Enable" }).click();
      await expect(mfaSection(page).locator(".status-pill")).toHaveText("Enabled");

      // Sign out and back in: a second factor is now required.
      await page.getByRole("button", { name: "Log out" }).click();
      await page.waitForURL(/\/login/);
      await signInAs(page, user.email, PASSWORD);
      await expect(page.getByRole("heading", { name: "Two-Factor Verification" })).toBeVisible();

      // The enrollment code belongs to a time step the server has already
      // accepted, so replaying it must fail. Without the replay guard this
      // succeeds, and one observed code is reusable for its whole window.
      await page.getByLabel("Code").fill(enrollCode);
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText(/invalid code/i), "a replayed code is refused").toBeVisible();

      // Wait for the next 30-second window; a fresh code then works.
      const msToNextStep = (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 1500;
      await page.waitForTimeout(msToNextStep);

      await page.getByLabel("Code").fill(await generateTotp({ secret }));
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForURL(/\/admin/);

      // And it can be turned off again, which requires the password.
      await page.goto("/admin/account");
      await mfaSection(page).getByLabel("Current Password").fill(PASSWORD);
      await mfaSection(page)
        .getByRole("button", { name: /Disable Two-Factor/i })
        .click();
      await expect(mfaSection(page).locator(".status-pill")).toHaveText("Disabled");
    } finally {
      // Deleting the user removes the MFA state with it, so this cleans up
      // even if the test failed midway through enrollment.
      await login(page);
      await page.request.delete(`/api/users/${user.id}`);
    }
  });
});
