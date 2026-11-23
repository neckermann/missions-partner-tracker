import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Zero prior coverage of this page (flagged in Phase 5 of the UX-rebuild
// plan). Drives the real webhook (routes/inboundEmail.js's POST
// /api/inbound-email/postmark) with a from-address that matches no
// partner, so it lands in the unmatched queue exactly the way a real
// inbound email would -- not a direct DB insert standing in for it.
test.describe("Inbound email queue", () => {
  test("an unmatched inbound email lands in the queue and can be discarded", async ({ page }) => {
    await login(page);

    // inboundEmail must be on before /api/settings/email (which sets the
    // webhook credentials) is even reachable -- see that route's own
    // requireFeature(["outboundEmail", "inboundEmail"]) gate.
    await page.request.put("/api/settings", { data: { enabledFeatures: { inboundEmail: true } } });

    const webhookUsername = "e2e-webhook-user";
    const webhookPassword = `e2e-webhook-pass-${Date.now()}`;
    await page.request.put("/api/settings/email", {
      data: { webhookUsername, webhookPassword },
    });

    const fromAddress = `unmatched-${Date.now()}@example.test`;
    const subject = `E2E unmatched ${Date.now()}`;
    const basicAuth = Buffer.from(`${webhookUsername}:${webhookPassword}`).toString("base64");
    const webhookRes = await page.request.post("/api/inbound-email/postmark", {
      headers: { Authorization: `Basic ${basicAuth}` },
      data: {
        FromFull: { Email: fromAddress },
        Subject: subject,
        MessageID: `e2e-${Date.now()}`,
        RawEmail: `From: ${fromAddress}\r\nTo: receive@updates.missionspartnertracker.com\r\nSubject: ${subject}\r\n\r\nE2E body.\r\n`,
      },
    });
    expect(webhookRes.ok()).toBeTruthy();
    expect((await webhookRes.json()).matched).toBe(false);

    await page.goto("/admin/inbound-email");
    await page.waitForSelector("h2");

    const row = page.locator("tbody tr", { hasText: fromAddress });
    await expect(row).toContainText(subject);

    await row.getByRole("button", { name: "Discard" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(fromAddress)).toHaveCount(0);
  });
});
