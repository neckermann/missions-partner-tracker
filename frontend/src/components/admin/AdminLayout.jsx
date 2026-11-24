import React, { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";
import UpdateBanner from "./UpdateBanner.jsx";
import BackupReminder from "./BackupReminder.jsx";
import ErrorBoundary from "../ErrorBoundary.jsx";
import useCurrentUser from "../../hooks/useCurrentUser.js";

// Shared shell for every /admin/* route (list pages, detail pages, and
// forms alike) — mounted once at the route level so the sidebar persists
// across navigation instead of being re-declared per page.
export default function AdminLayout() {
  const location = useLocation();
  const { isGuest, guestTripIds, loading } = useCurrentUser();

  // Guest (role: "guest") is a scoped login -- the subtree of each trip
  // it was granted, a read-only look at those trips' partners (Partner
  // Detail itself still enforces which ones, server-side), and its own
  // "My account" page (#356), nothing else. One check here instead of wrapping every other
  // route individually -- every /admin/* route renders through this
  // layout, so this is the single place that's guaranteed to see every
  // navigation. The backend's own requireTripScope/requirePartnerQueryScope
  // are still the real boundary (every route 403s on its own); this only
  // keeps a guest from seeing a flash of the wrong page first.
  if (!loading && isGuest) {
    const allowed =
      guestTripIds.some((id) => location.pathname.startsWith(`/admin/trips/${id}`)) ||
      location.pathname.startsWith("/admin/partners/") ||
      location.pathname === "/admin/account";
    if (!allowed) {
      // Carries a reason so the landing page can surface a real, visible
      // explanation (TripDetailLayout.jsx reads this) instead of a silent
      // bounce -- defense in depth for whatever link still slips through
      // despite every page deliberately not rendering one to a place this
      // role can't go (see TripDetailLayout.jsx's and
      // AdminTripParticipantDetail.jsx's own trimmed breadcrumbs).
      const home = guestTripIds[0];
      return (
        <Navigate
          to={home ? `/admin/trips/${home}` : "/login"}
          state={home ? { accessDenied: true } : undefined}
          replace
        />
      );
    }
  }

  return (
    <div className="admin-layout-wrapper">
      <UpdateBanner />
      <BackupReminder />
      <div className="admin-layout">
        <AdminSidebar />
        <main className="admin-main">
          {/* Inside the shell rather than around it, so one broken page
              leaves the sidebar and nav usable instead of blanking the whole
              admin app. Keyed on the path because an error boundary latches:
              without this, navigating away from the broken page would keep
              showing the error card. Suspense is scoped here too, not left
              to main.jsx's outer one -- without its own boundary, loading a
              not-yet-fetched page chunk falls through to the outer Suspense
              and blanks this entire layout (sidebar included) until it
              loads, instead of just this content area. */}
          <ErrorBoundary key={location.pathname} homeHref="/admin" homeLabel="the dashboard">
            <Suspense fallback={<div className="admin-shell">Loading…</div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
