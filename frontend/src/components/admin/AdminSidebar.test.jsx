import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";

// A guest (role: "guest", #356) is a scoped login -- this pins the nav half
// of that: one link per granted trip, one per distinct partner, "My
// account" (self-service password/MFA, reversing #329 Finding 2), log out,
// and no Settings. The backend route tests are in
// backend/test/routes/guestScope.test.js and the AdminLayout route guard
// in AdminLayout.test.jsx.
vi.mock("../../api/client.js", () => ({
  logout: vi.fn(),
}));

let currentUser;
vi.mock("../../hooks/useCurrentUser.js", () => ({
  default: () => currentUser,
}));

vi.mock("../../hooks/useNotifications.js", () => ({
  default: () => ({ categories: [], totalUnread: 0, markSeen: vi.fn() }),
}));

vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    churchName: "Test Church",
    partnerTermPlural: "Partners",
    usePartnerTermInAdmin: false,
    enabledFeatures: { trips: true, prayerRequests: true },
  }),
}));

function renderSidebar() {
  render(
    <MemoryRouter>
      <AdminSidebar />
    </MemoryRouter>
  );
}

describe("AdminSidebar -- guest tier", () => {
  it("renders a link per granted trip and partner, My account and Log out, but no Settings", () => {
    currentUser = {
      loading: false,
      isAdmin: false,
      isGuest: true,
      guestTrips: [
        { id: "trip-1", label: "Summer Build Trip", partnerId: "partner-1", partnerLabel: "Alpha Partner" },
        { id: "trip-2", label: "Fall Medical Trip", partnerId: "partner-2", partnerLabel: "Beta Partner" },
      ],
    };
    renderSidebar();

    expect(screen.getByRole("link", { name: /Summer Build Trip/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fall Medical Trip/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alpha Partner/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Beta Partner/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My account/i })).toHaveAttribute("href", "/admin/account");
    expect(screen.queryByRole("link", { name: /Settings/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log out/i })).toBeInTheDocument();
  });

  it("shows a partner once even when two granted trips share it", () => {
    currentUser = {
      loading: false,
      isAdmin: false,
      isGuest: true,
      guestTrips: [
        { id: "trip-1", label: "Trip One", partnerId: "partner-1", partnerLabel: "Shared Partner" },
        { id: "trip-2", label: "Trip Two", partnerId: "partner-1", partnerLabel: "Shared Partner" },
      ],
    };
    renderSidebar();

    expect(screen.getAllByRole("link", { name: /Shared Partner/i })).toHaveLength(1);
  });

  it("still shows My Account for a full role (admin)", () => {
    currentUser = { loading: false, isAdmin: true, isGuest: false, guestTrips: [] };
    renderSidebar();

    expect(screen.getByRole("link", { name: /My Account/i })).toBeInTheDocument();
  });
});
