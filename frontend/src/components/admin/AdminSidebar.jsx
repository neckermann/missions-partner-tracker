import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink as RouterNavLink, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import useCurrentUser from "../../hooks/useCurrentUser.js";
import useNotifications from "../../hooks/useNotifications.js";

// nav item key -> notification category key(s) worth a badge directly on
// the nav link (zero extra clicks to see "there's something here"). Not
// every category needs a nav badge; the bell below is the complete list.
// "trips" sums all 4 trip-related categories into one badge for that
// single nav link, rather than picking just the most urgent -- same
// shape a Trip Leader's own minimal nav uses for their one trip's signal.
const NAV_BADGE_CATEGORIES = {
  pendingDispatches: ["dispatchesNeedingApproval"],
  inboundEmail: ["unmatchedEmails"],
  prayerRequests: ["newPrayerRequests"],
  oneTimeNeeds: ["newOneTimeNeeds"],
  trips: [
    "tripsDepartingSoon",
    "tripsDepartingSoonIncomplete",
    "overdueTripRequirements",
    "tripApplicationsPending",
  ],
};

// Same convention as GitHub/Slack notification badges -- a 3+ digit count
// just stretches a pill meant to be a small circle; the real number is
// still available via the badge's own title/aria-label.
function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}

function NotificationBell({ categories, totalUnread, markSeen }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (open && ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const withCount = categories.filter((c) => c.count > 0);

  function toggle() {
    const opening = !open;
    if (opening && btnRef.current) {
      // position: fixed, computed from the button's own screen position --
      // `.admin-sidebar` clips horizontal overflow (overflow-x: hidden, for
      // its own text-truncation needs elsewhere), which silently clipped
      // this dropdown down to a sliver when it was just `position:
      // absolute` nested inside that ancestor. Fixed positioning escapes
      // that clip (no transformed ancestor sits between here and the
      // viewport), so the dropdown renders at its real width regardless of
      // the sidebar's own.
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
          className="admin-sidebar-bell-dropdown"
          role="menu"
          style={{ top: coords.top, left: coords.left }}
        >
          {withCount.length === 0 ? (
            <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>Nothing waiting.</p>
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
    enabledFeatures.oneTimeNeeds && {
      key: "oneTimeNeeds",
      to: "/admin/support/needs",
      icon: "🎁",
      label: "One-Time Needs",
    },
    enabledFeatures.trips && { key: "trips", to: "/admin/trips", icon: "✈️", label: "Trips" },
    // #272: same gate as "Trips" itself, not a second check against
    // enableTripBudgeting -- that sub-setting only decides whether the
    // page has anything to do once you're on it (see its own "Trip
    // budgeting isn't turned on yet" state), same way every other nav
    // entry here links to a page that might still show its own
    // not-configured-yet message rather than being hidden outright.
    enabledFeatures.trips && {
      key: "tripContributions",
      to: "/admin/trips/contributions",
      icon: "🧾",
      label: "Log Contributions",
    },
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

// A Trip Leader (role: "tripLeader") is a scoped guest -- their own
// trip, logged out, nothing else. No settings gear, no "My Account"
// (that guest tier has no self-service password change, see
// AccountSettings.jsx), no partner/prayer/needs/trips nav items, no
// collapse toggle (nothing here to need the extra room for).
function TripLeaderSidebar({ scopedTrip, title }) {
  const navigate = useNavigate();
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
      <nav className="admin-sidebar-nav">
        {scopedTrip && (
          <RouterNavLink
            to={`/admin/trips/${scopedTrip.id}`}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            <span aria-hidden="true">✈️</span>
            <span className="sb-label">{scopedTrip.label}</span>
          </RouterNavLink>
        )}
        {scopedTrip?.partnerId && (
          <RouterNavLink
            to={`/admin/partners/${scopedTrip.partnerId}`}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            <span aria-hidden="true">👤</span>
            <span className="sb-label">{scopedTrip.partnerLabel || "Partner"}</span>
          </RouterNavLink>
        )}
      </nav>
      <div className="admin-sidebar-footer">
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

export default function AdminSidebar() {
  const { loading: userLoading, isAdmin, isTripLeader, scopedTrip } = useCurrentUser();
  const { categories, totalUnread, markSeen } = useNotifications();
  const categoryByKey = new Map(categories.map((c) => [c.key, c]));
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const navigate = useNavigate();
  const location = useLocation();
  const { churchName, partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const title = churchName ? `${churchName} Admin` : "Missions Team Admin";

  // Until the role is known, render neither nav -- showing the full admin
  // nav by default (useCurrentUser's `user` starts null, so isTripLeader
  // is briefly false on every load) flashed every item a Trip Leader must
  // never see, for the instant before this resolves.
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

  if (isTripLeader) return <TripLeaderSidebar scopedTrip={scopedTrip} title={title} />;

  const navItems = buildNavItems(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures).map((item) => {
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
          <NotificationBell categories={categories} totalUnread={totalUnread} markSeen={markSeen} />
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
      </div>
    </aside>
  );
}
