import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCurrentUser,
  fetchPartners,
  fetchPendingDispatches,
  fetchPendingInboundEmails,
  fetchTrips,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getRecentlyViewed } from "../hooks/useRecentlyViewed.js";
import CardGrid from "../components/admin/CardGrid.jsx";

// The admin landing page -- search, recently-viewed, and needs-attention
// cards (UX-rebuild Phase 0), replacing the old shape: a full card-tile
// mirror of every single sidebar link, maintained as a second,
// independent copy of AdminSidebar.jsx's own nav structure. That's
// exactly the "two parallel nav surfaces" problem #270 named directly --
// Home now points at destinations worth jumping to directly (a search
// result, something recent, something waiting on you) rather than
// re-listing what the sidebar already lists.
//
// "Partner Care" keeps one card here deliberately -- it's the one group
// that earned its own landing page (3+ children; see
// AdminPartnerCare.jsx), so it's worth a direct way in from Home too,
// not because every group needs one.
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
  if (results.length === 0) return <p style={{ color: "#888" }}>No partners match "{debouncedTerm}".</p>;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {results.slice(0, 8).map((p) => (
        <li key={p.id} style={{ padding: "0.35rem 0", borderBottom: "1px solid #eee" }}>
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

// Three independent, already-available signals -- no new backend
// endpoints, just a page that actually surfaces what each one already
// returns: dispatches genuinely waiting, unmatched inbound emails, and
// trips departing within two weeks. Hidden entirely (not shown as
// "Nothing waiting") when a signal's count is zero -- a needs-attention
// card with nothing to report isn't worth the space it takes, and
// clutters the page on every visit instead of just the ones that matter.
function useNeedsAttention(enabledFeatures) {
  const [cards, setCards] = useState([]);

  useEffect(() => {
    const next = [];
    const loaders = [];

    if (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) {
      loaders.push(
        fetchPendingDispatches()
          .then((blurbs) => {
            const needingReview = blurbs.filter((b) => b.needsReview).length;
            if (blurbs.length > 0) {
              next.push({
                to: "/admin/pending-dispatches",
                category: "Communications",
                title: "Pending Dispatches",
                description:
                  needingReview > 0
                    ? `${blurbs.length} waiting, ${needingReview} needing review`
                    : `${blurbs.length} waiting to send`,
              });
            }
          })
          .catch(() => {})
      );
    }

    if (enabledFeatures.inboundEmail) {
      loaders.push(
        fetchPendingInboundEmails()
          .then((emails) => {
            if (emails.length > 0) {
              next.push({
                to: "/admin/inbound-email",
                category: "Communications",
                title: "Unmatched Emails",
                description: `${emails.length} inbound email${emails.length === 1 ? "" : "s"} to assign or discard`,
              });
            }
          })
          .catch(() => {})
      );
    }

    if (enabledFeatures.trips) {
      loaders.push(
        fetchTrips()
          .then((trips) => {
            const now = new Date();
            const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
            const departingSoon = trips.filter(
              (t) =>
                t.status !== "completed" &&
                t.startDate &&
                new Date(t.startDate) > now &&
                new Date(t.startDate) <= twoWeeksOut
            );
            if (departingSoon.length > 0) {
              next.push({
                to: "/admin/trips",
                category: "Trips",
                title: "Trips Departing Soon",
                description: `${departingSoon.length} trip${departingSoon.length === 1 ? "" : "s"} departing in the next two weeks`,
              });
            }
          })
          .catch(() => {})
      );
    }

    Promise.all(loaders).then(() => setCards(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabledFeatures.groupme,
    enabledFeatures.whatsapp,
    enabledFeatures.outboundEmail,
    enabledFeatures.inboundEmail,
    enabledFeatures.trips,
  ]);

  return cards;
}

// ⌘ on Mac, Ctrl elsewhere -- matches the convention every desktop app's
// own command-palette/search shortcut already uses on each platform.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform || "");
const SEARCH_SHORTCUT_HINT = isMac ? "⌘K" : "Ctrl+K";

export default function AdminHome() {
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch] = useState("");
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const needsAttention = useNeedsAttention(enabledFeatures);
  const searchInputRef = useRef(null);

  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  // Cmd/Ctrl+K focuses the Home search box from anywhere on the page --
  // the shortcut hint shown next to it would be misleading if it didn't
  // actually do anything.
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
        <CardGrid
          sections={[
            {
              to: "/admin/partner-care",
              title: "Partner Care",
              description: `${partnerLabel}, prayer requests, support, and documents — everything tracked for an individual partner.`,
            },
          ]}
        />
      </div>

      {currentUser?.role === "admin" && (
        <p>
          <Link to="/admin/settings/about">Settings →</Link>
        </p>
      )}
    </div>
  );
}
