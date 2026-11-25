import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers.jsx";
import { fetchUsers, fetchCurrentUser, fetchTrips, updateChurchSettings } from "../api/client.js";

// The church-wide two-factor requirement as an admin sees and changes it at the top of Manage
// Users: whether it is on, how many active accounts still have to enrol, and the toggle.
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
const confirmAnswer = vi.hoisted(() => ({ value: true }));
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(async () => confirmAnswer.value), confirmElement: null }),
}));

const person = (id, over = {}) => ({
  id,
  email: `${id}@example.test`,
  role: "editor",
  authProvider: "local",
  active: true,
  mfaEnabled: false,
  lastLoginAt: null,
  tripAccess: [],
  inactiveReason: null,
  ...over,
});
// Three active accounts, one enrolled; one inactive account that should not be counted.
const USERS = [
  person("a", { role: "admin", mfaEnabled: true }),
  person("b"),
  person("c", { role: "guest" }),
  person("d", { active: false }),
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer.value = true;
  fetchUsers.mockResolvedValue(USERS);
  fetchTrips.mockResolvedValue([]);
  fetchCurrentUser.mockResolvedValue({ id: "a", role: "admin", mfaEnabled: true, twoFactorRequired: false });
  updateChurchSettings.mockResolvedValue({ requireTwoFactor: true });
});

describe("Manage Users: two-factor sign-in", () => {
  it("says it is optional and how many active accounts still have to set it up", async () => {
    renderPage();

    expect(await screen.findByText("Optional")).toBeInTheDocument();
    // b and c have not enrolled; a has; d is inactive and not counted.
    expect(screen.getByText(/2 of 3 active accounts haven't set it up yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Require it for everyone" })).toBeEnabled();
  });

  it("turns it on after the admin confirms, with the church-wide setting", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Require it for everyone" }));

    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ requireTwoFactor: true }));
  });

  it("does nothing if the admin backs out of the confirmation", async () => {
    confirmAnswer.value = false;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Require it for everyone" }));

    await screen.findByText("Optional");
    expect(updateChurchSettings).not.toHaveBeenCalled();
  });

  it("is switched off by an admin who has not enrolled themselves, with the reason", async () => {
    fetchCurrentUser.mockResolvedValue({
      id: "a",
      role: "admin",
      mfaEnabled: false,
      twoFactorRequired: false,
    });
    renderPage();

    expect(await screen.findByRole("button", { name: "Require it for everyone" })).toBeDisabled();
    expect(screen.getByText(/Set up two-factor on your own account first/)).toBeInTheDocument();
  });

  it("shows when it is required, and lets the admin stop requiring it without a confirmation", async () => {
    fetchCurrentUser.mockResolvedValue({ id: "a", role: "admin", mfaEnabled: true, twoFactorRequired: true });
    updateChurchSettings.mockResolvedValue({ requireTwoFactor: false });
    renderPage();

    expect(await screen.findByText("Required for everyone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop requiring it" }));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ requireTwoFactor: false }));
  });

  it("shows the server's reason when it refuses", async () => {
    updateChurchSettings.mockRejectedValue({
      response: { data: { error: "Two-factor can't be required on the public demo" } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Require it for everyone" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/public demo/);
  });
});
