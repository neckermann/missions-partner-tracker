import React, { useEffect, useState } from "react";
import { Link, NavLink as RouterNavLink, useNavigate } from "react-router-dom";
import { fetchCurrentUser, logout } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";

// Left sidebar for the whole admin section (list/section pages, detail
// pages, and forms alike), replacing the old single-row top header nav —
// with this many sections, a horizontal row got crowded fast, while a
// vertical list has plenty of room to grow.
//
// Missionaries and organizations share one combined list page
// (AdminPartners) and one nav link — they used to be two separate links,
// but once a church sets a shared partner term (see Church Settings) those
// two links read identically, which looked like a bug. "Partners" is the
// generic default label; it swaps to the church's own term when
// usePartnerTermInAdmin is on.
function buildLinks(partnerTermPlural, usePartnerTermInAdmin) {
  return [
    { to: "/admin", label: "Home", end: true },
    { to: "/admin/partners", label: usePartnerTermInAdmin ? partnerTermPlural : "Partners" },
    { to: "/admin/support/monthly", label: "Monthly Support" },
    { to: "/admin/support/needs", label: "One-Time Needs" },
    { to: "/admin/trips", label: "Trip History" },
    { to: "/admin/trips/opportunities", label: "Trip Opportunities" },
    { to: "/admin/newsletters", label: "Newsletters" },
    { to: "/admin/documents", label: "Documents" },
    { to: "/admin/booklet", label: "Print Booklet" },
  ];
}

function SidebarLink({ to, label, end }) {
  return (
    <RouterNavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : undefined)}>
      {label}
    </RouterNavLink>
  );
}

export default function AdminSidebar() {
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();
  const { churchName, partnerTermPlural, usePartnerTermInAdmin } = useSettings();
  const links = buildLinks(partnerTermPlural, usePartnerTermInAdmin);
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";

  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  return (
    <aside className="admin-sidebar no-print">
      <h1 className="admin-sidebar-title">{title}</h1>
      <nav className="admin-sidebar-nav">
        {links.map((link) => (
          <SidebarLink key={link.to} {...link} />
        ))}
        {currentUser?.role === "admin" && (
          <>
            <div className="admin-sidebar-divider" />
            <SidebarLink to="/admin/users" label="Manage Users" />
            <SidebarLink to="/admin/settings" label="Church Settings" />
          </>
        )}
      </nav>
      <div className="admin-sidebar-footer">
        <SidebarLink to="/admin/account" label="My Account" />
        <Link to="/">View public site</Link>
        <button
          className="btn secondary"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
