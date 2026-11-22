import React, { useEffect, useState } from "react";
import { Link, NavLink as RouterNavLink, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import useCurrentUser from "../../hooks/useCurrentUser.js";

function buildNavItems(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    { key: "home", to: "/admin", end: true, icon: "🏠", label: "Home" },
    {
      key: "partners",
      to: "/admin/partners",
      icon: "👤",
      label: usePartnerTermInAdmin ? partnerTermPlural : "Partners",
    },
    enabledFeatures.partnerFiles && {
      key: "partnerFiles",
      to: "/admin/partner-files",
      icon: "📰",
      label: "Newsletters & Docs",
    },
    enabledFeatures.prayerRequests && {
      key: "prayerRequests",
      to: "/admin/prayer-requests",
      icon: "🙏",
      label: "Prayer Requests",
    },
    enabledFeatures.oneTimeNeeds && {
      key: "oneTimeNeeds",
      to: "/admin/support/needs",
      icon: "🎁",
      label: "One-Time Needs",
    },
    enabledFeatures.trips && { key: "trips", to: "/admin/trips", icon: "✈️", label: "Trips" },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      key: "pendingDispatches",
      to: "/admin/pending-dispatches",
      icon: "📨",
      label: "Pending Dispatches",
    },
    enabledFeatures.inboundEmail && {
      key: "inboundEmail",
      to: "/admin/inbound-email",
      icon: "📥",
      label: "Unmatched Email",
    },
    enabledFeatures.booklet && { key: "booklet", to: "/admin/booklet", icon: "📘", label: "Print Booklet" },
    enabledFeatures.reports && { key: "reports", to: "/admin/reports", icon: "📊", label: "Reports" },
  ].filter(Boolean);
}

function buildSiteAdminLinks(enabledFeatures) {
  return [
    { to: "/admin/settings/about", label: "About & Branding", icon: "🎨" },
    { to: "/admin/settings/users", label: "Manage Users", icon: "👥" },
    { to: "/admin/settings/features", label: "Enabled Features", icon: "🧩" },
    { to: "/admin/settings/system-info", label: "About App", icon: "ℹ️" },
    enabledFeatures.trips && { to: "/admin/settings/trips", label: "Trips", icon: "✈️" },
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      label: "Email",
      icon: "✉️",
    },
    enabledFeatures.groupme && { to: "/admin/settings/groupme", label: "GroupMe", icon: "💬" },
    enabledFeatures.whatsapp && { to: "/admin/settings/whatsapp", label: "WhatsApp", icon: "📱" },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/settings/dispatches",
      label: "Dispatches",
      icon: "🗓️",
    },
    (enabledFeatures.aiExtraction || enabledFeatures.joshuaProject) && {
      to: "/admin/settings/integrations",
      label: "Integrations",
      icon: "🔌",
    },
  ].filter(Boolean);
}

const SIDEBAR_COLLAPSED_KEY = "admin.sidebarCollapsed";

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(value) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

function SidebarLink({ to, label, end, icon }) {
  return (
    <RouterNavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) => (isActive ? "active" : undefined)}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className="sb-label">{label}</span>
    </RouterNavLink>
  );
}

export default function AdminSidebar() {
  const { isAdmin } = useCurrentUser();
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const navigate = useNavigate();
  const location = useLocation();
  const { churchName, partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const navItems = buildNavItems(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);
  const siteAdminLinks = buildSiteAdminLinks(enabledFeatures);
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";
  const inSiteAdmin = location.pathname.startsWith("/admin/settings");

  function toggleCollapsed() {
    setCollapsed((v) => {
      writeSidebarCollapsed(!v);
      return !v;
    });
  }

  const publicLinkNode = enabledFeatures.publicDirectory ? (
    <Link to="/" target="_blank" rel="noopener noreferrer" title="View Public Site">
      <span aria-hidden="true">🌐</span>
      <span className="sb-label">View Public Site</span>
    </Link>
  ) : (
    enabledFeatures.publicMap && (
      <Link to="/map" target="_blank" rel="noopener noreferrer" title="View Public Map">
        <span aria-hidden="true">🌐</span>
        <span className="sb-label">View Public Map</span>
      </Link>
    )
  );

  return (
    <aside className={collapsed ? "admin-sidebar no-print collapsed" : "admin-sidebar no-print"}>
      <div className="admin-sidebar-title">
        <h1
          className="admin-sidebar-title-text"
          title={title}
          style={{ fontSize: "inherit", fontWeight: "inherit", margin: 0 }}
        >
          {title}
        </h1>
        <span className="admin-sidebar-title-actions">
          <button type="button" className="admin-sidebar-bell-btn" title="Notifications (coming soon)">
            🔔
          </button>
          <button
            type="button"
            className="admin-sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "⟩⟩" : "⟨⟨"}
          </button>
        </span>
      </div>
      <nav className="admin-sidebar-nav">
        {navItems.map(({ key, ...item }) => (
          <SidebarLink key={key} {...item} />
        ))}
        {isAdmin && (
          <>
            <RouterNavLink to="/admin/settings" title="Settings" className={inSiteAdmin ? "active" : undefined}>
              <span aria-hidden="true">⚙️</span>
              <span className="sb-label">Settings</span>
            </RouterNavLink>
            {inSiteAdmin && (
              <div className="admin-sidebar-subnav">
                {siteAdminLinks.map((link) => (
                  <SidebarLink key={link.to} {...link} />
                ))}
              </div>
            )}
          </>
        )}
      </nav>
      <div className="admin-sidebar-footer">
        {publicLinkNode}
        <SidebarLink to="/admin/account" label="My Account" icon="🙋" />
        <button
          type="button"
          title="Log out"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          <span aria-hidden="true">🚪</span>
          <span className="sb-label">Log out</span>
        </button>
      </div>
    </aside>
  );
}
