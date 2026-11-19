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
//
// Grouped into real top-level collapsible sections (UX-rebuild Phase 0)
// instead of one flat list -- Partner Care / Trips / Communications /
// Reports, same expand/auto-expand-on-current-page mechanism Settings
// already had (see renderGroup below), generalized rather than
// reinvented. "Settings" (nee "Site Administration") itself stays a
// separate group further down (its own isLabel-divider sub-structure is
// untouched) -- e2e coverage (auth-boundary.spec.js) asserts on the
// button's current name, and nothing about its own internal grouping
// needed to change here.
function buildGroups(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    {
      key: "partnerCare",
      label: "Partner Care",
      links: [
        { to: "/admin/partners", label: usePartnerTermInAdmin ? partnerTermPlural : "Partners" },
        enabledFeatures.prayerRequests && { to: "/admin/prayer-requests", label: "Prayer Requests" },
        enabledFeatures.oneTimeNeeds && { to: "/admin/support/needs", label: "One-Time Needs" },
        enabledFeatures.monthlySupport && { to: "/admin/support/monthly", label: "Monthly Support" },
        enabledFeatures.partnerFiles && { to: "/admin/partner-files", label: "Newsletters & Docs" },
      ].filter(Boolean),
    },
    // One nav item now -- Trips and Plan a Trip merged into two tabs of
    // the same page (design review, post-#252): two separate nav items
    // for what's fundamentally one page made the real Trips/Plan-a-Trip
    // distinction look like an accidental duplicate, not the two
    // genuinely different questions they actually answer. Its own
    // group regardless, since a later phase splits its detail page into
    // real sub-pages under this same heading.
    enabledFeatures.trips && {
      key: "trips",
      label: "Trips",
      links: [{ to: "/admin/trips", label: "Trips" }],
    },
    {
      key: "communications",
      label: "Communications",
      links: [
        enabledFeatures.inboundEmail && { to: "/admin/inbound-email", label: "Unmatched Emails" },
        (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
          to: "/admin/pending-dispatches",
          label: "Pending Dispatches",
        },
      ].filter(Boolean),
    },
    {
      key: "reports",
      label: "Reports",
      links: [
        enabledFeatures.booklet && { to: "/admin/booklet", label: "Print Booklet" },
        enabledFeatures.reports && { to: "/admin/reports", label: "Reports" },
      ].filter(Boolean),
    },
  ].filter((group) => group && group.links.length > 0);
}

function groupContainsPath(group, pathname) {
  return group.links.some((link) => pathname === link.to || pathname.startsWith(`${link.to}/`));
}

function SidebarLink({ to, label, end }) {
  return (
    <RouterNavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : undefined)}>
      {label}
    </RouterNavLink>
  );
}

// One collapsible top-level group -- manually toggled, OR auto-expanded
// while already on one of its own pages (same reasoning Settings' own
// toggle already had: landing on a bookmarked deep link shouldn't show
// its own group collapsed with no indication of where you are).
// `expanded`/`onToggle` are lifted to the parent only so each group's
// state is independent of the others.
function SidebarGroup({ label, links, expanded, onToggle }) {
  return (
    <>
      <button
        type="button"
        className="admin-sidebar-group-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {label}
        <span className="admin-sidebar-group-arrow">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="admin-sidebar-subnav">
          {links.map((link) => (
            <SidebarLink key={link.to} {...link} />
          ))}
        </div>
      )}
    </>
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
// rather than adding a second collapsible level under Settings -- two
// dividers over nine total sub-items is still far less machinery than a
// nested expandable group.
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
    enabledFeatures.trips && { to: "/admin/settings/trips", label: "Trips Settings" },
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
  // Manual toggles per group, keyed by group.key -- each independent of
  // the others. A group not yet in here just falls back to whether the
  // current page is one of its own (see `expandedFor` below).
  const [manuallyExpanded, setManuallyExpanded] = useState({});
  // Same "manually-toggled OR auto-expanded while already on one of its
  // own pages" idea as the groups above, kept separate (its own state,
  // own label) rather than folded into buildGroups/manuallyExpanded --
  // see buildGroups' own comment for why.
  const [siteAdminExpanded, setSiteAdminExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { churchName, partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const groups = buildGroups(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);
  const siteAdminLinks = buildSiteAdminLinks(enabledFeatures);
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";
  const inSiteAdmin = location.pathname.startsWith("/admin/settings");
  const showSiteAdmin = siteAdminExpanded || inSiteAdmin;

  function expandedFor(group) {
    return Boolean(manuallyExpanded[group.key]) || groupContainsPath(group, location.pathname);
  }

  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  return (
    <aside className="admin-sidebar no-print">
      <h1 className="admin-sidebar-title">{title}</h1>
      <nav className="admin-sidebar-nav">
        <SidebarLink to="/admin" label="Home" end />
        {groups.map((group) => (
          <SidebarGroup
            key={group.key}
            label={group.label}
            links={group.links}
            expanded={expandedFor(group)}
            onToggle={() => setManuallyExpanded((m) => ({ ...m, [group.key]: !expandedFor(group) }))}
          />
        ))}
        {currentUser?.role === "admin" && (
          <>
            <div className="admin-sidebar-divider" />
            <button
              type="button"
              className="admin-sidebar-group-toggle"
              aria-expanded={showSiteAdmin}
              onClick={() => setSiteAdminExpanded((v) => !v)}
            >
              Settings
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
