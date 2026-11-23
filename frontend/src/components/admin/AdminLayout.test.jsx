import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import AdminLayout from "./AdminLayout.jsx";

// #329 Finding 2: AdminLayout's own route guard is the other half of the
// "Trip Leader has no self-service account page" policy (alongside
// AdminSidebar.jsx's missing nav link, covered in AdminSidebar.test.jsx,
// and the backend 403s in backend/test/routes/tripLeaderScope.test.js).
// This pins that /admin/account specifically falls outside the allowed
// subtree -- the guard predates this fix, but nothing previously proved
// Account Settings was actually one of the paths it bounces.
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
        ],
      },
    ],
    { initialEntries: [initialPath] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("AdminLayout -- Trip Leader route guard", () => {
  it("redirects a Trip Leader away from /admin/account to their own trip", async () => {
    currentUser = { isTripLeader: true, scopedTripId: "trip-1", loading: false };
    const router = renderAt("/admin/account");

    await screen.findByText("Trip Page");
    expect(router.state.location.pathname).toBe("/admin/trips/trip-1");
    expect(screen.queryByText("Account Settings Page")).not.toBeInTheDocument();
  });

  it("still allows a Trip Leader into their own scoped trip subtree", async () => {
    currentUser = { isTripLeader: true, scopedTripId: "trip-1", loading: false };
    renderAt("/admin/trips/trip-1");

    expect(await screen.findByText("Trip Page")).toBeInTheDocument();
  });

  it("allows a full role (admin) onto /admin/account", async () => {
    currentUser = { isTripLeader: false, scopedTripId: null, loading: false };
    renderAt("/admin/account");

    expect(await screen.findByText("Account Settings Page")).toBeInTheDocument();
  });
});
