import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";

// #329 Finding 2: a Trip Leader scoped guest (role: "tripLeader") is
// fully admin-managed, not self-service -- this pins the nav-visibility
// half of that policy (TripLeaderSidebar renders no "My Account"/
// Settings links at all), alongside the backend route tests in
// backend/test/routes/tripLeaderScope.test.js and the AdminLayout route
// guard covered in AdminLayout.test.jsx.
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

describe("AdminSidebar -- Trip Leader guest tier", () => {
  it("renders the scoped Trip Leader nav with no My Account or Settings link", () => {
    currentUser = {
      loading: false,
      isAdmin: false,
      isTripLeader: true,
      scopedTrip: {
        id: "trip-1",
        label: "Summer Build Trip",
        partnerId: "partner-1",
        partnerLabel: "Partner",
      },
    };
    renderSidebar();

    expect(screen.queryByRole("link", { name: /My Account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Settings/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Summer Build Trip/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log out/i })).toBeInTheDocument();
  });

  it("still shows My Account for a full role (admin)", () => {
    currentUser = { loading: false, isAdmin: true, isTripLeader: false, scopedTrip: null };
    renderSidebar();

    expect(screen.getByRole("link", { name: /My Account/i })).toBeInTheDocument();
  });
});
