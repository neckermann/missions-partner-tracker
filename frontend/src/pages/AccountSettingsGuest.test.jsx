import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import { fetchCurrentUser } from "../api/client.js";

// #356: a guest gets "My account" for password and MFA only. The admin
// digest is church-wide content, and MFA is required for the role so it
// can be enrolled but never switched off.
vi.mock("../api/client.js", () => ({
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

const user = (role, mfaEnabled) => ({
  id: "u1",
  email: "someone@example.test",
  role,
  authProvider: "local",
  mfaEnabled,
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
    expect(screen.getByText(/Guest accounts need an extra step/)).toBeInTheDocument();
  });

  it("offers no way to disable MFA once enrolled, and says why", async () => {
    fetchCurrentUser.mockResolvedValue(user("guest", true));
    render(<AccountSettings />);

    expect(await screen.findByText(/required for guest accounts/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disable Two-Factor/ })).not.toBeInTheDocument();
  });

  it("still shows the digest section and the disable button to a full role", async () => {
    fetchCurrentUser.mockResolvedValue(user("editor", true));
    render(<AccountSettings />);

    expect(await screen.findByText("Email Dispatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disable Two-Factor/ })).toBeInTheDocument();
  });
});
