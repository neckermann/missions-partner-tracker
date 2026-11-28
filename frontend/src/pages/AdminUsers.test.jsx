import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers.jsx";
import {
  fetchUsers,
  fetchUser,
  fetchCurrentUser,
  fetchTrips,
  fetchReachablePartners,
  updateUser,
} from "../api/client.js";
import { waitFor } from "@testing-library/react";

// The Users list shows what a guest can reach and when it lapses, flags accounts that can't
// currently sign in, and filters down to just those so an admin can reach out and clean up.
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
  fetchReachablePartners: vi.fn(),
}));
let careOn = true;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { careTeam: careOn } }),
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
  fetchReachablePartners.mockResolvedValue([]);
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

  it("says a guest with nothing left to reach has no access, not that they have no trips", async () => {
    fetchUsers.mockResolvedValue([
      {
        ...base,
        id: "g9",
        email: "care-guest@example.test",
        role: "guest",
        tripAccess: [],
        inactiveReason: "no_access",
      },
    ]);
    renderPage();
    const row = (await screen.findByText("care-guest@example.test")).closest("tr");
    expect(within(row).getByText("No access left")).toBeInTheDocument();
    expect(screen.queryByText(/No trips left/)).not.toBeInTheDocument();
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

// Promoting an existing editor to a guest: a guest reaches something only through a trip or a
// care team seat, so the modal offers both.
describe("AdminUsers -- promote to guest with a care team seat (#289)", () => {
  const EDITOR = { ...base, id: "e1", email: "pat@example.test", role: "editor", tripAccess: [] };

  async function openPromote() {
    careOn = true;
    fetchUsers.mockResolvedValue([USERS[0], EDITOR]);
    fetchUser.mockResolvedValue({ ...EDITOR, careTeamSeats: [] });
    fetchReachablePartners.mockResolvedValue([{ id: "p1", displayName: "Alpha Partner", archived: false }]);
    updateUser.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByText("pat@example.test"));
    const dialog = await screen.findByRole("dialog");
    const role = within(dialog).getByDisplayValue("Editor");
    fireEvent.change(role, { target: { value: "guest" } });
    return dialog;
  }

  it("lets a partner alone be the guest's first access, and sends it as careTeam", async () => {
    const dialog = await openPromote();
    expect(within(dialog).getByText("Care team")).toBeTruthy();
    const picker = await within(dialog).findByLabelText(/Add a partner to look after/);
    fireEvent.change(picker, { target: { value: "p1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    const [id, payload] = updateUser.mock.calls[0];
    expect(id).toBe("e1");
    expect(payload.role).toBe("guest");
    expect(payload.careTeam).toEqual([{ partnerId: "p1" }]);
    expect(payload.tripAccess).toEqual([]);
    expect(payload).not.toHaveProperty("careTeamSeats");
  });

  it("still refuses a guest with neither a trip nor a partner", async () => {
    const dialog = await openPromote();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/at least one trip or partner/i)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("has no care team step, and asks only for a trip, when care teams are off", async () => {
    const dialog = await openPromote();
    // reopen with the feature off
    careOn = false;
    cleanup();
    fetchUsers.mockResolvedValue([USERS[0], EDITOR]);
    renderPage();
    fireEvent.click(await screen.findByText("pat@example.test"));
    const d2 = await screen.findByRole("dialog");
    fireEvent.change(within(d2).getByDisplayValue("Editor"), { target: { value: "guest" } });
    expect(within(d2).queryByText("Care team")).toBeNull();
    fireEvent.click(within(d2).getByRole("button", { name: "Save" }));
    expect(await within(d2).findByText(/Choose at least one trip for this guest/)).toBeTruthy();
    expect(dialog).toBeTruthy();
  });
});

describe("AdminUsers -- a sole administrator", () => {
  it("is told to add a second administrator", async () => {
    renderPage();
    expect(await screen.findByText(/You are the only administrator/)).toBeInTheDocument();
  });

  it("is not nagged once there are two active administrators", async () => {
    fetchUsers.mockResolvedValue([
      ...USERS,
      {
        ...base,
        id: "b",
        email: "second-admin@example.test",
        role: "admin",
        tripAccess: [],
        inactiveReason: null,
      },
    ]);
    renderPage();
    await screen.findByText("second-admin@example.test");
    expect(screen.queryByText(/You are the only administrator/)).not.toBeInTheDocument();
  });
});
