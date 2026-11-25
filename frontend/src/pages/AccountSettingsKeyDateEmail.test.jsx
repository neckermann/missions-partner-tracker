import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import { fetchCurrentUser, setKeyDateEmailOptOut } from "../api/client.js";

// Anyone on a care team (a guest included) can turn off their own daily key-date email; the
// bell alert is unaffected.
vi.mock("../api/client.js", () => ({
  fetchPasskeys: vi.fn().mockResolvedValue({ passkeys: [], max: 5 }),
  registerPasskey: vi.fn(),
  removePasskey: vi.fn(),
  browserSupportsWebAuthn: () => true,
  fetchCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  setupMfa: vi.fn(),
  verifyMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  updateNotifyByEmail: vi.fn(),
  setKeyDateEmailOptOut: vi.fn(),
  fetchPartners: vi.fn().mockResolvedValue([]),
}));
let features;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features, cadenceTiersEnabled: {} }),
}));
vi.mock("../components/shared/ThemeToggle.jsx", () => ({ default: () => null }));

const user = (extra = {}) => ({
  id: "u1",
  email: "someone@example.test",
  role: "editor",
  authProvider: "local",
  mfaEnabled: false,
  twoFactorRequired: false,
  cadence: null,
  followedPartnerIds: [],
  careTeamSeats: [{ id: "p1", label: "Ann & Bob", isLead: false }],
  keyDateEmailOptOut: false,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  features = { careTeam: true, keyDates: true, outboundEmail: true };
  setKeyDateEmailOptOut.mockResolvedValue({});
});

describe("My account: the key-date email (#365)", () => {
  it("says the email is on, and keeps the bell either way", async () => {
    fetchCurrentUser.mockResolvedValue(user());
    render(<AccountSettings />);
    expect(await screen.findByText("Key-date email")).toBeInTheDocument();
    expect(screen.getByText(/On\. You get one email/)).toBeInTheDocument();
    expect(screen.getByText(/alert on the bell stays either way/)).toBeInTheDocument();
  });

  it("is offered to a care team guest too, not only to staff", async () => {
    fetchCurrentUser.mockResolvedValue(user({ role: "guest" }));
    render(<AccountSettings />);
    expect(await screen.findByText("Key-date email")).toBeInTheDocument();
  });

  it("turns the email off for yourself", async () => {
    fetchCurrentUser.mockResolvedValue(user());
    render(<AccountSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /key-date email/i }));
    fireEvent.click(await screen.findByLabelText(/Email me about coming birthdays/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setKeyDateEmailOptOut).toHaveBeenCalledWith(true));
  });

  it("is hidden when you are on no care team, or the feature or email is off", async () => {
    for (const [u, f] of [
      [user({ careTeamSeats: [] }), features],
      [user(), { careTeam: true, keyDates: false, outboundEmail: true }],
      [user(), { careTeam: true, keyDates: true, outboundEmail: false }],
    ]) {
      features = f;
      fetchCurrentUser.mockResolvedValue(u);
      const { unmount } = render(<AccountSettings />);
      await screen.findByText("Change Password");
      expect(screen.queryByText("Key-date email")).not.toBeInTheDocument();
      unmount();
    }
  });
});
