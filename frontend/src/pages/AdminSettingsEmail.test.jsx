import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsEmail from "./AdminSettingsEmail.jsx";
import { fetchEmailSettings, updateEmailSettings } from "../api/client.js";

// Receiving: mail from a partner's own address can skip the review, but only when an admin switches that on,
// and the page says in plain words what each setting does.
vi.mock("../api/client.js", () => ({
  fetchEmailSettings: vi.fn(),
  updateEmailSettings: vi.fn(),
  sendTestEmail: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ refreshSettings: vi.fn() }),
}));

const base = {
  sendEnabled: true,
  outboundConfigured: true,
  fromAddress: "a@example.test",
  receiveEnabled: true,
  inboundConfigured: true,
  inboundEmailAddress: null,
  webhookUsername: "hook",
  webhookPath: "/api/inbound-email/postmark",
  skipReview: false,
};

const renderIt = () =>
  render(
    <MemoryRouter>
      <AdminSettingsEmail />
    </MemoryRouter>
  );

beforeEach(() => {
  fetchEmailSettings.mockReset();
  updateEmailSettings.mockReset();
});

describe("AdminSettingsEmail -- review of inbound mail", () => {
  it("says every message waits when the review is on (the default)", async () => {
    fetchEmailSettings.mockResolvedValue(base);
    renderIt();
    expect(await screen.findByText(/Every message waits in Emails to Sort/)).toBeInTheDocument();
  });

  it("says what skipping the review does when it is on", async () => {
    fetchEmailSettings.mockResolvedValue({ ...base, skipReview: true });
    renderIt();
    expect(await screen.findByText(/filed and announced without review/)).toBeInTheDocument();
  });

  it("saves the switch, unticked by default", async () => {
    fetchEmailSettings.mockResolvedValue(base);
    updateEmailSettings.mockResolvedValue({ ...base, skipReview: true });
    renderIt();
    fireEvent.click(await screen.findByText("Receiving"));
    const box = await screen.findByLabelText("File mail from a verified partner without review");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getAllByRole("button", { name: /^Save/ }).at(-1));
    await waitFor(() =>
      expect(updateEmailSettings).toHaveBeenCalledWith(expect.objectContaining({ skipReview: true }))
    );
  });
});
