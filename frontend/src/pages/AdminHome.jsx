import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPartners } from "../api/client.js";
import usePublicSiteChoiceRedirect from "../hooks/usePublicSiteChoiceRedirect.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getRecentlyViewed } from "../hooks/useRecentlyViewed.js";
import CardGrid from "../components/admin/CardGrid.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import useNotifications from "../hooks/useNotifications.js";

// key -> short group label for the card grid; the registry
// (backend/src/notifications/categories.js) doesn't carry one.
const CATEGORY_GROUP = {
  dispatchesNeedingApproval: "Communications",
  unmatchedEmails: "Communications",
  inboundEmailFailures: "Communications",
  surveyUpdatesPending: "Partner Care",
  dispatchSendFailures: "Communications",
  tripsDepartingSoon: "Trips",
  tripsDepartingSoonIncomplete: "Trips",
  overdueTripRequirements: "Trips",
  tripApplicationsPending: "Trips",
  tripsReadyToWrapUp: "Trips",
  tripsWrappedUp: "Trips",
  newPrayerRequests: "Partner Care",
  newOneTimeNeeds: "Partner Care",
  adminMfaDisabled: "System",
  emailNotFinished: "System",
  timeToCheckBackups: "System",
  whatsappConnectionDrop: "System",
};

// Admin landing page: search, recently viewed, and needs-attention cards. Links to
// destinations worth jumping to, not a re-list of the sidebar.
const SEARCH_DEBOUNCE_MS = 250;

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function SearchResults({ term }) {
  const [results, setResults] = useState(null);
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (!debouncedTerm.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    fetchPartners({ q: debouncedTerm.trim(), archived: false })
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedTerm]);

  if (results === null) return null;
  if (results.length === 0)
    return <p style={{ color: "var(--muted)" }}>No partners match "{debouncedTerm}".</p>;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {results.slice(0, 8).map((p) => (
        <li key={p.id} style={{ padding: "0.35rem 0", borderBottom: "1px solid var(--border)" }}>
          <Link to={`/admin/partners/${p.id}`}>{p.displayName}</Link>
        </li>
      ))}
    </ul>
  );
}

function RecentlyViewed() {
  const [entries] = useState(() => getRecentlyViewed());
  if (entries.length === 0) return null;
  return (
    <div className="admin-section">
      <h3 style={{ marginTop: 0 }}>Recently viewed</h3>
      <div className="recent-row">
        {entries.map((entry) => (
          <Link key={entry.to} to={entry.to} className="recent-chip">
            <b>{entry.kind}</b>
            {entry.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ⌘ on Mac, Ctrl elsewhere.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform || "");
const SEARCH_SHORTCUT_HINT = isMac ? "⌘K" : "Ctrl+K";

function buildMainSections(partnerLabel, enabledFeatures, isAdmin) {
  return [
    {
      to: "/admin/partners",
      title: partnerLabel,
      icon: "👤",
      description: "Missionaries, families, and partner organizations — profiles, trips, and contact info.",
    },
    enabledFeatures.partnerFiles && {
      to: "/admin/partner-files",
      title: "Newsletters & Docs",
      icon: "📰",
      description:
        "Upload and browse newsletters, survey responses, signed policies, and other documents from missionary and organization partners.",
    },
    enabledFeatures.prayerRequests && {
      to: "/admin/prayer-requests",
      title: "Prayer Requests",
      icon: "🙏",
      description: "Track prayer requests across every partner, short-term and long-term.",
    },
    enabledFeatures.oneTimeNeeds && {
      to: "/admin/support/needs",
      title: "One-Time Needs",
      icon: "🎁",
      description: "Track one-time gift requests and record decisions.",
    },
    enabledFeatures.trips && {
      to: "/admin/trips",
      title: "Trips",
      icon: "✈️",
      description: "Mission trips, team recruiting, meetings, and requirements.",
    },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/pending-dispatches",
      title: "Pending Dispatches",
      icon: "📨",
      description: "Review and approve GroupMe, WhatsApp, and email sends before they go out.",
    },
    enabledFeatures.inboundEmail && {
      to: "/admin/inbound-email",
      title: "Unmatched Email",
      icon: "📥",
      description: "Inbound emails that couldn't be automatically matched to a partner.",
    },
    enabledFeatures.booklet && {
      to: "/admin/booklet",
      title: "Print Booklet",
      icon: "📘",
      description: "Generate the printable prayer & support directory.",
    },
    enabledFeatures.reports && {
      to: "/admin/reports",
      title: "Reports",
      icon: "📊",
      description: "Read-only reports over existing data — birthdays, support, trips, and more.",
    },
    isAdmin && {
      to: "/admin/settings",
      title: "Settings",
      icon: "⚙️",
      description: "Church info, branding, users, features, and integrations.",
    },
  ].filter(Boolean);
}

export default function AdminHome() {
  const { user: currentUser, isAdmin } = useCurrentUser();
  const [search, setSearch] = useState("");
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const { categories } = useNotifications();

  usePublicSiteChoiceRedirect(isAdmin);
  // Categories with a zero count are hidden. Reads the shared registry the bell uses
  // (/api/notifications/summary); don't add a page-level fetch alongside it, the two
  // drifted apart before and a card never cleared.
  const needsAttention = categories
    .filter((c) => c.count > 0)
    .map((c) => ({
      to: c.linkTo,
      category: CATEGORY_GROUP[c.key] || "Needs attention",
      title: c.label,
      description: `${c.count} item${c.count === 1 ? "" : "s"}`,
    }));
  const searchInputRef = useRef(null);

  // Cmd/Ctrl+K focuses search; the visible hint would mislead otherwise.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const partnerLabel = usePartnerTermInAdmin ? partnerTermPlural : "Partners";

  return (
    <div className="admin-shell">
      <h2>Welcome{currentUser?.firstName ? `, ${currentUser.firstName}` : ""}</h2>

      <div className="admin-section">
        <label htmlFor="home-search-input" style={{ display: "block", marginBottom: "0.4rem" }}>
          {`Search ${partnerLabel.toLowerCase()}`}
        </label>
        <div className="home-search">
          <span aria-hidden="true">🔍</span>
          <input
            id="home-search-input"
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Find a ${partnerLabel.toLowerCase().replace(/s$/, "")} by name…`}
          />
          <span className="home-search-kbd-hint" aria-hidden="true">
            {SEARCH_SHORTCUT_HINT}
          </span>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <SearchResults term={search} />
        </div>
      </div>

      <RecentlyViewed />

      {needsAttention.length > 0 && (
        <div className="admin-section">
          <h3 style={{ marginTop: 0 }}>Needs attention</h3>
          <CardGrid sections={needsAttention} />
        </div>
      )}

      <div className="admin-section">
        <h3 style={{ marginTop: 0 }}>Browse</h3>
        <CardGrid sections={buildMainSections(partnerLabel, enabledFeatures, isAdmin)} />
      </div>
    </div>
  );
}
