import React from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";
import UpdateBanner from "./UpdateBanner.jsx";
import BackupReminder from "./BackupReminder.jsx";

// Shared shell for every /admin/* route (list pages, detail pages, and
// forms alike) — mounted once at the route level so the sidebar persists
// across navigation instead of being re-declared per page.
export default function AdminLayout() {
  return (
    <div className="admin-layout-wrapper">
      <UpdateBanner />
      <BackupReminder />
      <div className="admin-layout">
        <AdminSidebar />
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
