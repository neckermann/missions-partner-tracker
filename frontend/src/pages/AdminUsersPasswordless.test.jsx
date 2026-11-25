import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers.jsx";
import { fetchUsers, fetchCurrentUser, fetchTrips, updateChurchSettings } from "../api/client.js";

// #386 Layer 2: the Passwordless sign-in switch on Manage Users: when it is usable, why it isn't,
// who will sign in by emailed link, and turning it on and off.
vi.mock("../api/client.js", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchTrips: vi.fn(),
  deleteUser: vi.fn(),
  sendUserSetupLink: vi.fn(),
  resetUserMfa: vi.fn(),
  updateUser: vi.fn(),
  fetchReachablePartners: vi.fn(),
  updateChurchSettings: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {} }),
}));
const confirmAnswer = vi.hoisted(() => ({ value: true, lastBody: null }));
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({
    confirm: vi.fn(async (opts) => {
      confirmAnswer.lastBody = opts;
      return confirmAnswer.value;
    }),
    confirmElement: null,
  }),
}));

const person = (id, over = {}) => ({
  id,
  email: `${id}@example.test`,
  role: "editor",
  authProvider: "local",
  active: true,
  mfaEnabled: false,
  passkeyCount: 0,
  lastLoginAt: null,
  tripAccess: [],
  inactiveReason: null,
  ...over,
});
// Three active accounts, one with a passkey; one inactive that should not be counted.
const USERS = [
  person("a", { role: "admin", mfaEnabled: true, passkeyCount: 1 }),
  person("b"),
  person("c", { role: "guest" }),
  person("d", { active: false }),
];
const me = (over = {}) => ({
  id: "a",
  role: "admin",
  mfaEnabled: true,
  passkeyCount: 1,
  emailReady: true,
  twoFactorRequired: false,
  passwordlessRequired: false,
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>
  );
const button = (name) => screen.findByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer.value = true;
  fetchUsers.mockResolvedValue(USERS);
  fetchTrips.mockResolvedValue([]);
  fetchCurrentUser.mockResolvedValue(me());
  updateChurchSettings.mockResolvedValue({});
});

describe("Manage Users: passwordless sign-in", () => {
  it("says it is off and how many active accounts have no passkey yet", async () => {
    renderPage();
    expect(await button("Turn on passwordless sign-in")).toBeEnabled();
    expect(screen.getByText(/2 of 3 active accounts have no passkey yet/)).toBeInTheDocument();
  });

  it("turns it on after confirming, naming how many will sign in by emailed link", async () => {
    renderPage();
    fireEvent.click(await button("Turn on passwordless sign-in"));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ requirePasswordless: true }));
    expect(JSON.stringify(confirmAnswer.lastBody)).toContain("2 active accounts have no passkey yet");
  });

  it("does nothing when the admin cancels", async () => {
    confirmAnswer.value = false;
    renderPage();
    fireEvent.click(await button("Turn on passwordless sign-in"));
    await waitFor(() => expect(confirmAnswer.lastBody).not.toBeNull());
    expect(updateChurchSettings).not.toHaveBeenCalled();
  });

  it("is disabled, with the reason, until email works", async () => {
    fetchCurrentUser.mockResolvedValue(me({ emailReady: false }));
    renderPage();
    expect(await button("Turn on passwordless sign-in")).toBeDisabled();
    expect(screen.getByText(/Turn on outbound email and finish setting it up first/)).toBeInTheDocument();
  });

  it("is disabled, with the reason, until the admin has a passkey of their own", async () => {
    fetchCurrentUser.mockResolvedValue(me({ passkeyCount: 0 }));
    renderPage();
    expect(await button("Turn on passwordless sign-in")).toBeDisabled();
    expect(screen.getByText(/Add a passkey to your own account first/)).toBeInTheDocument();
  });

  it("when on, says so and turns off without a confirmation", async () => {
    fetchCurrentUser.mockResolvedValue(me({ passwordlessRequired: true, twoFactorRequired: true }));
    renderPage();
    expect(await screen.findByText("On: no passwords")).toBeInTheDocument();
    fireEvent.click(await button("Turn off passwordless sign-in"));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ requirePasswordless: false }));
  });

  it("shows the server's reason when it refuses", async () => {
    updateChurchSettings.mockRejectedValue({ response: { data: { error: "Add a passkey first" } } });
    renderPage();
    fireEvent.click(await button("Turn on passwordless sign-in"));
    expect(await screen.findByText("Add a passkey first")).toBeInTheDocument();
  });
});
