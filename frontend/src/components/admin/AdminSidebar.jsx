import React, { useEffect, useState } from "react";
import { Link, NavLink as RouterNavLink, useLocation, useNavigate } from "react-router-dom";
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
function buildLinks(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    { to: "/admin", label: "Home", end: true },
    { to: "/admin/partners", label: usePartnerTermInAdmin ? partnerTermPlural : "Partners" },
    enabledFeatures.inboundEmail && { to: "/admin/inbound-email", label: "Unmatched Emails" },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/pending-dispatches",
      label: "Pending Dispatches",
    },
    enabledFeatures.partnerFiles && { to: "/admin/partner-files", label: "Newsletters & Docs" },
    enabledFeatures.prayerRequests && { to: "/admin/prayer-requests", label: "Prayer Requests" },
    enabledFeatures.oneTimeNeeds && { to: "/admin/support/needs", label: "One-Time Needs" },
    enabledFeatures.monthlySupport && { to: "/admin/support/monthly", label: "Monthly Support" },
    enabledFeatures.trips && { to: "/admin/trips", label: "Trip History", end: true },
    enabledFeatures.trips && { to: "/admin/trips/opportunities", label: "Trip Opportunities" },
    enabledFeatures.booklet && { to: "/admin/booklet", label: "Print Booklet" },
    enabledFeatures.reports && { to: "/admin/reports", label: "Reports" },
  ].filter(Boolean);
}

function SidebarLink({ to, label, end }) {
  return (
    <RouterNavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : undefined)}>
      {label}
    </RouterNavLink>
  );
}

// About Church, Manage Users, Branding, Enabled Features, Backups,
// System Info -- order as specified, not alphabetical or route order.
// These six sit together (not with the links below them) since every
// church needs them regardless of which features are on -- not gated
// by a feature toggle for the same reason (#195: core admin tooling,
// not an opt-in feature).
//
// Below that, two kinds of optional integration, visually split by what
// they actually do -- GroupMe and Email both *send and/or receive
// communications* (Email's own sending/receiving halves are themselves
// independently gated -- see utils/features.js -- but share one settings
// page, so one link covers both); Joshua Project and AI Features
// *pull data in* or process content, never communicate with anyone.
// isLabel marks a plain section caption (rendered as text, not a link)
// rather than adding a second collapsible level under Site
// Administration -- two dividers over nine total sub-items is still far
// less machinery than a nested expandable group.
function buildSiteAdminLinks(enabledFeatures) {
  return [
    { to: "/admin/settings/about", label: "About Church" },
    { to: "/admin/settings/users", label: "Manage Users" },
    { to: "/admin/settings/branding", label: "Branding" },
    { to: "/admin/settings/features", label: "Enabled Features" },
    { to: "/admin/settings/backups", label: "Backups" },
    { to: "/admin/settings/system-info", label: "System Info" },
    (enabledFeatures.groupme ||
      enabledFeatures.whatsapp ||
      enabledFeatures.outboundEmail ||
      enabledFeatures.inboundEmail) && {
      label: "Communications",
      isLabel: true,
    },
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      label: "Email",
    },
    enabledFeatures.groupme && { to: "/admin/settings/groupme", label: "GroupMe" },
    enabledFeatures.whatsapp && { to: "/admin/settings/whatsapp", label: "WhatsApp" },
    // Schedule(s), GroupMe's content-type mutes, the restricted-partner
    // safety gate, digest appearance, and (when the public digest is on)
    // its subscriber counts -- all one page now. The actual queue (what's
    // waiting to send) is its own top-level "Pending Dispatches" link
    // above, same "content, not settings" split Unmatched Emails already
    // has from Email's own settings page. Gated on groupme/whatsapp/outboundEmail
    // specifically (not inboundEmail, which doesn't drive any
    // dispatch sending).
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/settings/dispatches",
      label: "Dispatch Settings",
    },
    (enabledFeatures.joshuaProject || enabledFeatures.aiExtraction) && {
      label: "Integrations",
      isLabel: true,
    },
    enabledFeatures.aiExtraction && { to: "/admin/settings/ai-extraction", label: "AI Features" },
    enabledFeatures.joshuaProject && { to: "/admin/settings/joshua-project", label: "Joshua Project" },
  ].filter(Boolean);
}

export default function AdminSidebar() {
  const [currentUser, setCurrentUser] = useState(null);
  // Manually-toggled OR auto-expanded while already on one of its own
  // pages, so navigating straight to e.g. /admin/settings/branding (a
  // bookmark, a page refresh) doesn't leave the group looking collapsed
  // with no visible indication of where you are.
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { churchName, partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const links = buildLinks(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);
  const siteAdminLinks = buildSiteAdminLinks(enabledFeatures);
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";
  const inSiteAdmin = location.pathname.startsWith("/admin/settings");
  const showSiteAdmin = expanded || inSiteAdmin;

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
            <button
              type="button"
              className="admin-sidebar-group-toggle"
              aria-expanded={showSiteAdmin}
              onClick={() => setExpanded((v) => !v)}
            >
              Site Administration
              <span className="admin-sidebar-group-arrow">{showSiteAdmin ? "▾" : "▸"}</span>
            </button>
            {showSiteAdmin && (
              <div className="admin-sidebar-subnav">
                {siteAdminLinks.map((link) =>
                  link.isLabel ? (
                    <div key={link.label} className="admin-sidebar-subnav-label">
                      {link.label}
                    </div>
                  ) : (
                    <SidebarLink key={link.to} {...link} />
                  )
                )}
              </div>
            )}
          </>
        )}
      </nav>
      <div className="admin-sidebar-footer">
        <SidebarLink to="/admin/account" label="My Account" />
        {/* Prefers the directory as the primary public entry point; falls
            back to the map if only that's on, and hides entirely if
            neither public-facing page is enabled. New tab so following it
            never navigates the admin itself away from where it was. */}
        {enabledFeatures.publicDirectory ? (
          <Link to="/" target="_blank" rel="noopener noreferrer">
            View public site
          </Link>
        ) : (
          enabledFeatures.publicMap && (
            <Link to="/map" target="_blank" rel="noopener noreferrer">
              View public map
            </Link>
          )
        )}
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
