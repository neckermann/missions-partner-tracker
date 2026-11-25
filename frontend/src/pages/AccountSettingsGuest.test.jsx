import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import { fetchCurrentUser } from "../api/client.js";

// #356: a guest gets "My account" for password and MFA only; the admin digest is church-wide
// content. Two-factor is not specific to the role (#385): it can be switched off by the person
// unless the church requires it of everyone, which hides the switch-off for every role.
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
  fetchPartners: vi.fn().mockResolvedValue([]),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { outboundEmail: true }, cadenceTiersEnabled: {} }),
}));
vi.mock("../components/shared/ThemeToggle.jsx", () => ({ default: () => null }));

const user = (role, mfaEnabled, twoFactorRequired = false) => ({
  id: "u1",
  email: "someone@example.test",
  role,
  authProvider: "local",
  mfaEnabled,
  authenticatorApp: mfaEnabled,
  twoFactorRequired,
  cadence: null,
  followedPartnerIds: [],
});

beforeEach(() => fetchCurrentUser.mockReset());

describe("AccountSettings -- guest (#356)", () => {
  it("shows password and MFA but not the admin digest section", async () => {
    fetchCurrentUser.mockResolvedValue(user("guest", false));
    render(<AccountSettings />);

    expect(await screen.findByText("Change Password")).toBeInTheDocument();
    expect(screen.getByText("Two-Factor Authentication")).toBeInTheDocument();
    expect(screen.queryByText("Email Dispatch")).not.toBeInTheDocument();
    expect(screen.getByText(/Add an extra step at login/)).toBeInTheDocument();
  });

  it("lets a guest switch two-factor off like anyone else when the church doesn't require it", async () => {
    fetchCurrentUser.mockResolvedValue(user("guest", true, false));
    render(<AccountSettings />);

    expect(await screen.findByRole("button", { name: /Disable Two-Factor/ })).toBeInTheDocument();
  });

  it("offers nobody a way to disable MFA once the church requires it, and says why", async () => {
    for (const role of ["guest", "editor", "admin"]) {
      fetchCurrentUser.mockResolvedValue(user(role, true, true));
      const { unmount } = render(<AccountSettings />);

      expect(await screen.findByText(/requires two-factor authentication for everyone/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Disable Two-Factor/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("still shows the digest section and the disable button to a full role", async () => {
    fetchCurrentUser.mockResolvedValue(user("editor", true));
    render(<AccountSettings />);

    expect(await screen.findByText("Email Dispatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disable Two-Factor/ })).toBeInTheDocument();
  });
});
