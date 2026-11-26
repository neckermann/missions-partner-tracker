import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";

// A guest (role: "guest") is a scoped login; this pins the nav half of that: one link per
// granted trip, one per distinct partner, "My account" (self-service password/MFA), log out,
// and no Settings. The backend route tests are in backend/test/routes/guestScope.test.js and
// the AdminLayout route guard in AdminLayout.test.jsx.
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

let enabledFeatures = { trips: true, prayerRequests: true };
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    churchName: "Test Church",
    partnerTermPlural: "Partners",
    usePartnerTermInAdmin: false,
    enabledFeatures,
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
  beforeEach(() => {
    enabledFeatures = {
      trips: true,
      prayerRequests: true,
      oneTimeNeeds: true,
      partnerFiles: true,
      booklet: true,
      reports: true,
      groupme: true,
    };
  });

  it("a care team member gets the same list pages as everyone, minus the ones they can't use", () => {
    currentUser = {
      loading: false,
      isAdmin: false,
      isGuest: true,
      guestTrips: [],
      careTeamSeats: [{ id: "p1", label: "P" }],
    };
    renderSidebar();

    for (const name of ["Partners", "Newsletters & Docs", "Prayer Requests", "One-Time Needs", "Trips"]) {
      expect(screen.getByRole("link", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
    for (const name of ["Home", "Print Booklet", "Reports", "Pending Dispatches", "Settings"]) {
      expect(screen.queryByRole("link", { name: new RegExp(name, "i") })).not.toBeInTheDocument();
    }
  });

  it("a trip leader's smaller scope gets just Trips and Partners", () => {
    currentUser = { loading: false, isAdmin: false, isGuest: true, guestTrips: [], careTeamSeats: [] };
    renderSidebar();

    expect(screen.getByRole("link", { name: /Partners/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Trips/i })).toBeInTheDocument();
    for (const name of ["Newsletters & Docs", "Prayer Requests", "One-Time Needs", "Reports", "Home"]) {
      expect(screen.queryByRole("link", { name: new RegExp(name, "i") })).not.toBeInTheDocument();
    }
  });

  it("has the same header and footer as everyone: collapse button, My Account, Log out and the theme toggle", () => {
    currentUser = { loading: false, isAdmin: false, isGuest: true, guestTrips: [], careTeamSeats: [] };
    renderSidebar();

    expect(screen.getByTitle("Collapse sidebar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My Account/ })).toHaveAttribute("href", "/admin/account");
    expect(screen.getByRole("button", { name: /Log out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
  });

  it("still honours the church's feature flags", () => {
    enabledFeatures = { prayerRequests: true };
    currentUser = {
      loading: false,
      isAdmin: false,
      isGuest: true,
      guestTrips: [],
      careTeamSeats: [{ id: "p1", label: "P" }],
    };
    renderSidebar();

    expect(screen.getByRole("link", { name: /Prayer Requests/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /One-Time Needs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Trips/i })).not.toBeInTheDocument();
  });

  it("still shows My Account for a full role (admin)", () => {
    currentUser = { loading: false, isAdmin: true, isGuest: false, guestTrips: [] };
    renderSidebar();

    expect(screen.getByRole("link", { name: /My Account/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Home/i })).toBeInTheDocument();
  });

  it("lists Monthly Support for staff when the feature is on, and never for a guest", () => {
    enabledFeatures = { monthlySupport: true, prayerRequests: true };
    currentUser = { loading: false, isAdmin: true, isGuest: false, guestTrips: [], careTeamSeats: [] };
    renderSidebar();
    expect(screen.getByRole("link", { name: /Monthly Support/i })).toHaveAttribute(
      "href",
      "/admin/support/monthly"
    );
  });

  it("hides Monthly Support from a guest even with the feature on", () => {
    enabledFeatures = { monthlySupport: true, prayerRequests: true };
    currentUser = {
      loading: false,
      isAdmin: false,
      isGuest: true,
      guestTrips: [],
      careTeamSeats: [{ id: "p1", label: "P" }],
    };
    renderSidebar();
    expect(screen.queryByRole("link", { name: /Monthly Support/i })).not.toBeInTheDocument();
  });

  it("hides Monthly Support when the feature is off", () => {
    enabledFeatures = { monthlySupport: false };
    currentUser = { loading: false, isAdmin: true, isGuest: false, guestTrips: [], careTeamSeats: [] };
    renderSidebar();
    expect(screen.queryByRole("link", { name: /Monthly Support/i })).not.toBeInTheDocument();
  });
});
