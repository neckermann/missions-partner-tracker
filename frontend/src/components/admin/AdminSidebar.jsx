import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import { Link, NavLink as RouterNavLink, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import useCurrentUser from "../../hooks/useCurrentUser.js";
import useNotifications from "../../hooks/useNotifications.js";
import ThemeToggle from "../shared/ThemeToggle.jsx";

// nav item key -> notification categories worth a badge on the nav link. "trips" sums all four
// trip-related categories into one badge.
const NAV_BADGE_CATEGORIES = {
  pendingDispatches: ["dispatchesNeedingApproval"],
  inboundEmail: ["unmatchedEmails"],
  surveyUpdates: ["surveyUpdatesPending"],
  prayerRequests: ["newPrayerRequests"],
  oneTimeNeeds: ["newOneTimeNeeds"],
  trips: ["tripsDepartingSoon", "overdueTripRequirements", "tripApplicationsPending", "tripsReadyToWrapUp"],
};

// A 3+ digit count stretches the pill; the real number stays in the title/aria-label.
function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}

// Smallest gap kept between the bell dropdown and the screen edge, in px.
const BELL_EDGE = 8;

function NotificationBell({ categories, totalUnread, markSeen }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (open && ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // The dropdown is position: fixed, so it would drift from its button on scroll or resize: close it.
  useEffect(() => {
    if (!open) return undefined;
    function close(e) {
      if (e.type === "scroll" && e.target instanceof Node && dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Keep the dropdown on screen: on a phone the bell sits near the right edge, so measure once
  // rendered and pull it back in.
  useLayoutEffect(() => {
    if (!open || !coords || !dropdownRef.current) return;
    const width = dropdownRef.current.getBoundingClientRect().width;
    const left = Math.max(BELL_EDGE, Math.min(coords.left, window.innerWidth - width - BELL_EDGE));
    if (left !== coords.left) setCoords((c) => ({ ...c, left }));
  }, [open, coords]);

  const withCount = categories.filter((c) => c.count > 0);

  function toggle() {
    const opening = !open;
    if (opening && btnRef.current) {
      // position: fixed from the button's screen position: `.admin-sidebar` clips horizontal overflow,
      // which cut an absolutely positioned dropdown to a sliver.
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(opening);
    if (opening) withCount.forEach((c) => markSeen(c.key));
  }

  return (
    <div className="admin-sidebar-bell" ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        className="admin-sidebar-bell-btn"
        title="Notifications"
        onClick={toggle}
        aria-expanded={open}
      >
        🔔
        {totalUnread > 0 && (
          <span className="admin-sidebar-bell-badge" title={`${totalUnread} unread`}>
            {badgeText(totalUnread)}
          </span>
        )}
      </button>
      {open && coords && (
        <div
          ref={dropdownRef}
          className="admin-sidebar-bell-dropdown"
          role="menu"
          style={{ top: coords.top, left: coords.left }}
        >
          {withCount.length === 0 ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>Nothing waiting.</p>
          ) : (
            withCount.map((c) => (
              <Link
                key={c.key}
                to={c.linkTo}
                className="admin-sidebar-bell-item"
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">{c.icon}</span>
                <span className="admin-sidebar-bell-item-label">{c.label}</span>
                <span className="admin-sidebar-bell-item-count">{c.count}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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
    enabledFeatures.prayerRequests && {
      key: "prayerSheet",
      to: "/admin/prayer-sheet",
      icon: "🕊️",
      label: "Prayer Sheet",
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
      label: "Updates to Share",
    },
    enabledFeatures.inboundEmail && {
      key: "inboundEmail",
      to: "/admin/inbound-email",
      icon: "📥",
      label: "Emails to Sort",
    },
    enabledFeatures.surveys && {
      key: "surveyUpdates",
      to: "/admin/survey-updates",
      icon: "📝",
      label: "Survey Updates",
    },
    enabledFeatures.monthlySupport && {
      key: "monthlySupport",
      to: "/admin/support/monthly",
      icon: "💵",
      label: "Monthly Support",
    },
    enabledFeatures.booklet && { key: "booklet", to: "/admin/booklet", icon: "📘", label: "Print Booklet" },
    enabledFeatures.reports && { key: "reports", to: "/admin/reports", icon: "📊", label: "Reports" },
  ].filter(Boolean);
}

function buildSiteAdminLinks(enabledFeatures) {
  return [
    { to: "/admin/settings/about", label: "About & Branding", icon: "🎨" },
    { to: "/admin/settings/privacy", label: "Privacy and Safety", icon: "🔒" },
    { to: "/admin/settings/users", label: "Manage Users", icon: "👥" },
    enabledFeatures.auditTrail && { to: "/admin/settings/audit", label: "Audit Log", icon: "📜" },
    { to: "/admin/settings/features", label: "Enabled Features", icon: "🧩" },
    enabledFeatures.trips && { to: "/admin/settings/trips", label: "Trips", icon: "✈️" },
    (enabledFeatures.careTeam || enabledFeatures.keyDates || enabledFeatures.contactLog) && {
      to: "/admin/settings/partner-care",
      label: "Partner Care",
      icon: "🤝",
    },
    enabledFeatures.supportPreferences && {
      to: "/admin/settings/support-preferences",
      label: "Support Preferences",
      icon: "💛",
    },
    enabledFeatures.surveys && { to: "/admin/settings/surveys", label: "Surveys", icon: "📝" },
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      label: "Email",
      icon: "✉️",
    },
    enabledFeatures.groupme && { to: "/admin/settings/groupme", label: "GroupMe", icon: "💬" },
    enabledFeatures.whatsapp && { to: "/admin/settings/whatsapp", label: "WhatsApp", icon: "📱" },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/settings/dispatches",
      label: "Sending Updates",
      icon: "🗓️",
    },
    (enabledFeatures.aiExtraction || enabledFeatures.joshuaProject) && {
      to: "/admin/settings/integrations",
      label: "Integrations",
      icon: "🔌",
    },
    { to: "/admin/settings/system-info", label: "About App", icon: "ℹ️" },
  ].filter(Boolean);
}

const SIDEBAR_COLLAPSED_KEY = "admin.sidebarCollapsed";

// The width at which the sidebar stops sitting beside the page and becomes a slim bar on top of
// it (keep in step with the @media (max-width: 800px) rules in index.css).
const PHONE_QUERY = "(max-width: 800px)";

function usePhoneWidth() {
  const [phone, setPhone] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_QUERY).matches : false
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

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

function SidebarLink({ to, label, end, icon, badgeCount }) {
  return (
    <RouterNavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) => (isActive ? "active" : undefined)}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className="sb-label">{label}</span>
      {badgeCount > 0 && (
        <span className="admin-sidebar-nav-badge" title={`${badgeCount}`}>
          {badgeText(badgeCount)}
        </span>
      )}
    </RouterNavLink>
  );
}

// A guest sees the same sidebar shell with fewer entries: only pages limited server-side to the
// partners and trips they reach. A trip leader gets Trips and Partners; a care team member also
// gets the list pages for the partners they look after.
const TRIP_GUEST_NAV_KEYS = new Set(["partners", "trips"]);
const CARE_GUEST_NAV_KEYS = new Set(["partners", "partnerFiles", "prayerRequests", "oneTimeNeeds", "trips"]);

export default function AdminSidebar() {
  const { loading: userLoading, isAdmin, isGuest, careTeamSeats } = useCurrentUser();
  const { categories, totalUnread, markSeen } = useNotifications();
  const categoryByKey = new Map(categories.map((c) => [c.key, c]));
  const [collapsedPref, setCollapsed] = useState(readSidebarCollapsed);
  // On a phone the menu starts closed so the opened page is on the first screen, and closes again
  // after a choice. The desktop collapse preference means nothing there.
  const phone = usePhoneWidth();
  const [menuOpen, setMenuOpen] = useState(false);
  const collapsed = collapsedPref && !phone;
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  const { churchName, partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";

  // Until the role is known render neither nav: `user` starts null, so isGuest is briefly false and
  // the full admin nav would flash items a guest must never see.
  if (userLoading) {
    return (
      <aside className="admin-sidebar no-print">
        <div className="admin-sidebar-title">
          <h1
            className="admin-sidebar-title-text"
            title={title}
            style={{ fontSize: "inherit", fontWeight: "inherit", margin: 0 }}
          >
            {title}
          </h1>
        </div>
      </aside>
    );
  }

  const navItems = buildNavItems(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures)
    .filter(
      (item) =>
        !isGuest || (careTeamSeats.length > 0 ? CARE_GUEST_NAV_KEYS : TRIP_GUEST_NAV_KEYS).has(item.key)
    )
    .map((item) => {
      const categoryKeys = NAV_BADGE_CATEGORIES[item.key];
      const badgeCount = categoryKeys
        ? categoryKeys.reduce((sum, key) => sum + (categoryByKey.get(key)?.count || 0), 0)
        : undefined;
      return badgeCount ? { ...item, badgeCount } : item;
    });
  const siteAdminLinks = buildSiteAdminLinks(enabledFeatures);
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
    <aside
      className={
        "admin-sidebar no-print" + (collapsed ? " collapsed" : "") + (phone && menuOpen ? " menu-open" : "")
      }
    >
      <div className="admin-sidebar-title">
        <h1
          className="admin-sidebar-title-text"
          title={title}
          style={{ fontSize: "inherit", fontWeight: "inherit", margin: 0 }}
        >
          {title}
        </h1>
        <span className="admin-sidebar-title-actions">
          <NotificationBell categories={categories} totalUnread={totalUnread} markSeen={markSeen} />
          <button
            type="button"
            className="admin-sidebar-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar-menu"
          >
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span> Menu
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
      <div id="admin-sidebar-menu" className="admin-sidebar-menu">
        <nav className="admin-sidebar-nav">
          {navItems.map(({ key, ...item }) => (
            <SidebarLink key={key} {...item} />
          ))}
          {isAdmin && !isGuest && (
            <>
              <RouterNavLink
                to="/admin/settings"
                title="Settings"
                className={inSiteAdmin ? "active" : undefined}
              >
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
          <div className="admin-sidebar-theme-toggle">
            <ThemeToggle compact />
          </div>
        </div>
      </div>
    </aside>
  );
}
