import React, { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";
import UpdateBanner from "./UpdateBanner.jsx";
import BackupReminder from "./BackupReminder.jsx";
import SiteAddressBanner from "./SiteAddressBanner.jsx";
import GuestNotice from "./GuestNotice.jsx";
import ErrorBoundary from "../ErrorBoundary.jsx";
import useCurrentUser from "../../hooks/useCurrentUser.js";
import FeaturePausedPage from "../FeaturePausedPage.jsx";

// Shared shell for every /admin/* route, mounted once so the sidebar persists across navigation.
export default function AdminLayout() {
  const location = useLocation();
  const {
    isGuest,
    guestTripIds,
    guestReadTripIds,
    careTeamSeats,
    pausedFeatures = [],
    loading,
  } = useCurrentUser();

  // A guest whose every grant depends on a feature the church has switched off has nothing left to open: say so
  // plainly (the server refuses everything but this answer, middleware/requireAuth.js). Access returns unchanged
  // when the feature is switched back on.
  if (
    !loading &&
    isGuest &&
    pausedFeatures.length > 0 &&
    guestTripIds.length === 0 &&
    careTeamSeats.length === 0
  ) {
    return <FeaturePausedPage features={pausedFeatures} signOut />;
  }
  // A guest who still has care team partners but whose trips are paused sees the same page where trips were.
  const tripsPausedHere =
    !loading && isGuest && pausedFeatures.includes("trips") && location.pathname.startsWith("/admin/trips");

  // A guest is a scoped login: its granted trips, a read-only look at their partners, and "My
  // account". Checked here because every /admin/* route renders through this layout. The backend
  // (requireTripScope/requirePartnerQueryScope) is the real boundary; this only avoids a flash of
  // the wrong page.
  if (!loading && isGuest) {
    const allowed =
      // Every trip the guest may open: those they were granted, and -- read
      // only -- their care team partner's trips.
      guestReadTripIds.some((id) => location.pathname.startsWith(`/admin/trips/${id}`)) ||
      location.pathname.startsWith("/admin/partners/") ||
      // The Partners and Trips lists every role has, each limited by the server
      // to what the guest reaches ...
      ["/admin/partners", "/admin/trips"].includes(location.pathname) ||
      // ...and the other list pages only for a care team member -- a trip
      // leader's scope is smaller.
      (careTeamSeats.length > 0 &&
        ["/admin/partner-files", "/admin/prayer-requests", "/admin/support/needs"].includes(
          location.pathname
        )) ||
      location.pathname === "/admin/account";
    if (!allowed) {
      // Carries a reason so the landing page can explain the redirect (TripDetailLayout.jsx reads it).
      // Back to their own first trip (with a visible reason); a guest who
      // reaches things only through a care team seat goes to their partners;
      // one with nothing at all goes to sign in.
      const home = guestTripIds[0];
      const to = home ? `/admin/trips/${home}` : careTeamSeats.length > 0 ? "/admin/partners" : "/login";
      // Only when they went somewhere they should not. Arriving at the plain /admin home (right after signing
      // in) is not a mistake, so it gets no "you don't have access" note, just their trip.
      const arrivedAtHome = location.pathname === "/admin" || location.pathname === "/admin/";
      return <Navigate to={to} state={home && !arrivedAtHome ? { accessDenied: true } : undefined} replace />;
    }
  }

  return (
    <div className="admin-layout-wrapper">
      <UpdateBanner />
      <SiteAddressBanner />
      <BackupReminder />
      <div className="admin-layout">
        <AdminSidebar />
        <main className="admin-main">
          <GuestNotice />
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
              {tripsPausedHere ? <FeaturePausedPage features={["trips"]} /> : <Outlet />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
