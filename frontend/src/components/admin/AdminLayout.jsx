import React, { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";
import UpdateBanner from "./UpdateBanner.jsx";
import BackupReminder from "./BackupReminder.jsx";
import ErrorBoundary from "../ErrorBoundary.jsx";

// Shared shell for every /admin/* route (list pages, detail pages, and
// forms alike) — mounted once at the route level so the sidebar persists
// across navigation instead of being re-declared per page.
export default function AdminLayout() {
  const location = useLocation();

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
