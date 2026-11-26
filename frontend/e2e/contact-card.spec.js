import { test, expect } from "@playwright/test";
import { login, firstSelectablePartner } from "./helpers.js";

// The contact card on a partner's page is the one place who to reach, how they like to be reached
// and how careful to be are shown and edited.
test.describe("Contact card", () => {
  test("edit how careful to be, who to go through, and how they like to be reached", async ({ page }) => {
    await login(page);
    const partner = await firstSelectablePartner(page);
    await page.goto(`/admin/partners/${partner.id}`);
    const card = page.locator("#contact-card");
    await expect(card).toBeVisible();

    // Use caution, email only.
    await card.getByRole("button", { name: "Edit contact", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("How they like to be reached").selectOption("email");
    await dialog.getByRole("radio", { name: /Use caution/ }).check();
    await dialog.getByLabel("Email", { exact: true }).check();
    await dialog.getByLabel(/^Guidelines/).fill("Email only, and no exclamation marks.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("Use caution")).toBeVisible();
    await expect(card.getByText(/Reach them by email only/)).toBeVisible();
    await expect(card.getByText(/no exclamation marks/)).toBeVisible();
    await expect(card.getByText(/Prefers/)).toBeVisible();
    await expect(card.getByRole("link", { name: "Call" })).toHaveCount(0);

    // Don't contact directly: their details give way to who to go through.
    await card.getByRole("button", { name: "Edit contact", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Don't contact directly/ }).check();
    await dialog.getByLabel("Go through (name)").fill("Mission office");
    await dialog.getByLabel("Their email").fill("office@example.org");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("Don't contact directly")).toBeVisible();
    await expect(card.getByText("Mission office")).toBeVisible();
    await expect(card.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:office@example.org"
    );
    await expect(card.getByText(/Prefers/)).toHaveCount(0);

    // Back to normal, so the seeded partner is left as it was.
    await card.getByRole("button", { name: "Edit contact", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /^Normal/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("Don't contact directly")).toHaveCount(0);
  });
});
