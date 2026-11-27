import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import AdminLayout from "./AdminLayout.jsx";

// AdminLayout's route guard for a guest (role: "guest"): the subtree of each trip they were
// granted, those trips' partners, and their own "My account" page, nothing else. The backend
// 403s in backend/test/routes/guestScope.test.js are the real boundary; this pins that the UI
// doesn't flash a page they can't use.
vi.mock("./AdminSidebar.jsx", () => ({ default: () => <div>Sidebar</div> }));
vi.mock("./UpdateBanner.jsx", () => ({ default: () => null }));
vi.mock("./BackupReminder.jsx", () => ({ default: () => null }));
vi.mock("../ErrorBoundary.jsx", () => ({ default: ({ children }) => <>{children}</> }));

let currentUser;
vi.mock("../../hooks/useCurrentUser.js", () => ({
  default: () => currentUser,
}));

function renderAt(initialPath) {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <div>Login Page</div> },
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "account", element: <div>Account Settings Page</div> },
          { path: "trips/:id", element: <div>Trip Page</div> },
          { path: "partners/:id", element: <div>Partner Page</div> },
          { path: "partners", element: <div>Partner Page</div> },
          { path: "prayer-requests", element: <div>Prayer List</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

const guest = (tripIds, { readIds = tripIds, seats = [] } = {}) => ({
  isGuest: true,
  guestTripIds: tripIds,
  guestReadTripIds: readIds,
  careTeamSeats: seats,
  loading: false,
});

describe("AdminLayout -- guest route guard", () => {
  it("allows a guest onto their own My account page", async () => {
    currentUser = guest(["trip-1"]);
    renderAt("/admin/account");

    expect(await screen.findByText("Account Settings Page")).toBeInTheDocument();
  });

  it("allows a guest into each trip they were granted, not just the first", async () => {
    currentUser = guest(["trip-1", "trip-2"]);
    renderAt("/admin/trips/trip-2");

    expect(await screen.findByText("Trip Page")).toBeInTheDocument();
  });

  it("redirects a guest from a trip they hold no grant for to their first granted trip", async () => {
    currentUser = guest(["trip-1", "trip-2"]);
    const router = renderAt("/admin/trips/trip-9");

    await screen.findByText("Trip Page");
    expect(router.state.location.pathname).toBe("/admin/trips/trip-1");
  });

  it("still lets a guest open a partner page (the backend decides which)", async () => {
    currentUser = guest(["trip-1"]);
    renderAt("/admin/partners/partner-1");

    expect(await screen.findByText("Partner Page")).toBeInTheDocument();
  });

  it("lets a care team member open (read-only) a trip of their partner they weren't granted", async () => {
    currentUser = guest([], { readIds: ["trip-7"], seats: [{ id: "p1", label: "P" }] });
    renderAt("/admin/trips/trip-7");

    expect(await screen.findByText("Trip Page")).toBeInTheDocument();
  });

  it("sends a seat-only guest who strays to their partners, not to sign in", async () => {
    currentUser = guest([], { readIds: ["trip-7"], seats: [{ id: "p1", label: "P" }] });
    const router = renderAt("/admin/trips/trip-9");

    expect(await screen.findByText("Partner Page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/partners");
  });

  it("lets a care team member open the prayer requests list, but not a trip leader", async () => {
    currentUser = guest(["trip-1"], { seats: [{ id: "p1", label: "P" }] });
    renderAt("/admin/prayer-requests");
    expect(await screen.findByText("Prayer List")).toBeInTheDocument();
  });

  it("keeps a trip leader off the care-team list pages", async () => {
    currentUser = guest(["trip-1"]);
    const router = renderAt("/admin/prayer-requests");
    await screen.findByText("Trip Page");
    expect(router.state.location.pathname).toBe("/admin/trips/trip-1");
  });

  it("sends a guest with no active trip to the login page", async () => {
    currentUser = guest([]);
    const router = renderAt("/admin/trips/trip-1");

    await screen.findByText("Login Page");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("allows a full role (admin) onto /admin/account", async () => {
    currentUser = { isGuest: false, guestTripIds: [], loading: false };
    renderAt("/admin/account");

    expect(await screen.findByText("Account Settings Page")).toBeInTheDocument();
  });
});
