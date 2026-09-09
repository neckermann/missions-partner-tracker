import React from "react";
import { NavLink, Outlet } from "react-router-dom";

// Shared shell for /admin/settings/* -- same "sidebar/tabs + Outlet" role
// AdminLayout.jsx plays for /admin/* generally, one level down. An
// underline-tab row (see .admin-settings-tabs in index.css), not a second
// full sidebar, since it only has to hold a handful of settings categories
// and lives inside a page that's already inside the main sidebar's
// "Church Settings" section. New settings categories (integrations,
// backups, etc.) are a new tab here + a new child route in main.jsx, not
// a restructure.
const TABS = [
  { to: "/admin/settings/general", label: "Church Details" },
  { to: "/admin/settings/branding", label: "Branding" },
  { to: "/admin/settings/features", label: "Features" },
  { to: "/admin/settings/sso", label: "Single Sign-On" },
  { to: "/admin/settings/users", label: "Users" },
];

export default function AdminSettingsLayout() {
  return (
    <div className="admin-shell">
      <h2>Church Settings</h2>
      <nav className="admin-settings-tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : undefined)}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
