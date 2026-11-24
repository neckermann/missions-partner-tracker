import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers.jsx";
import { fetchUsers, fetchCurrentUser, fetchTrips } from "../api/client.js";

// #356: the Users list shows what a guest can reach and when it lapses,
// flags accounts that can't currently sign in, and filters down to just
// those so an admin can reach out and clean up.
vi.mock("../api/client.js", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchTrips: vi.fn(),
  deleteUser: vi.fn(),
  sendUserSetupLink: vi.fn(),
  resetUserMfa: vi.fn(),
  updateUser: vi.fn(),
  fetchUserTripAccess: vi.fn(),
}));
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(), confirmElement: null }),
}));

const grant = (over) => ({
  id: "g",
  tripId: "t",
  trip: { name: "Summer Build", partner: { displayName: "Alpha Partner" } },
  active: true,
  effectiveExpiresAt: "2027-07-01T23:59:59.999Z",
  ...over,
});

const base = { authProvider: "local", active: true, mfaEnabled: true, lastLoginAt: null };
const USERS = [
  { ...base, id: "a", email: "admin@example.test", role: "admin", tripAccess: [], inactiveReason: null },
  {
    ...base,
    id: "g1",
    email: "current-guest@example.test",
    role: "guest",
    tripAccess: [grant({ id: "g1a" })],
    inactiveReason: null,
  },
  {
    ...base,
    id: "g2",
    email: "lapsed-guest@example.test",
    role: "guest",
    tripAccess: [grant({ id: "g2a", active: false, effectiveExpiresAt: "2026-01-02T23:59:59.999Z" })],
    inactiveReason: "expired",
  },
  {
    ...base,
    id: "g3",
    email: "orphan-guest@example.test",
    role: "guest",
    active: false,
    tripAccess: [],
    inactiveReason: "deactivated",
  },
];

function renderPage() {
  render(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchUsers.mockResolvedValue(USERS);
  fetchCurrentUser.mockResolvedValue({ id: "a" });
  fetchTrips.mockResolvedValue([]);
});

describe("AdminUsers -- guests (#356)", () => {
  it("labels a guest and lists each trip with when it lapses", async () => {
    renderPage();

    const row = (await screen.findByText("current-guest@example.test")).closest("tr");
    expect(within(row).getByText("Guest")).toBeInTheDocument();
    expect(within(row).getByText(/Alpha Partner — Summer Build · until/)).toBeInTheDocument();
  });

  it("flags accounts that can't sign in, with the reason", async () => {
    renderPage();

    const lapsed = (await screen.findByText("lapsed-guest@example.test")).closest("tr");
    expect(within(lapsed).getByText("Access expired")).toBeInTheDocument();
    const orphan = screen.getByText("orphan-guest@example.test").closest("tr");
    expect(within(orphan).getByText("Deactivated")).toBeInTheDocument();
  });

  it("filters to inactive accounts only, and back", async () => {
    renderPage();
    await screen.findByText("current-guest@example.test");

    fireEvent.click(screen.getByLabelText(/Inactive accounts only \(2\)/));
    expect(screen.queryByText("current-guest@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("admin@example.test")).not.toBeInTheDocument();
    expect(screen.getByText("lapsed-guest@example.test")).toBeInTheDocument();
    expect(screen.getByText("orphan-guest@example.test")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Inactive accounts only/));
    expect(screen.getByText("current-guest@example.test")).toBeInTheDocument();
  });

  it("doesn't offer the filter when no account is inactive", async () => {
    fetchUsers.mockResolvedValue(USERS.slice(0, 2));
    renderPage();
    await screen.findByText("current-guest@example.test");

    expect(screen.queryByLabelText(/Inactive accounts only/)).not.toBeInTheDocument();
  });
});
