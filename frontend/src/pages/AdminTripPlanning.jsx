import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchTripPlanning, cloneTrip } from "../api/client.js";
import { formatDate } from "../utils/format.js";

// Renamed from AdminTripOpportunities.jsx (#252) -- "Opportunities" now
// belongs to the public-facing discovery page (PublicTripOpportunities.jsx)
// instead. This page answers a different question: which partner to plan
// the *next* trip to, blending three kinds of signal per partner rather
// than a single query -- an "open" row (a trip already recruiting), a
// "committed" row (roster finalized, not yet happened), or a "fallback"
// row (just the partner's own general trip capacity, nothing scheduled).
const KIND_LABELS = {
  open: "Open",
  committed: "Committed",
  fallback: "No trip scheduled",
};
const KIND_COLORS = {
  open: "#1f6b4f",
  committed: "#2a5d8f",
  fallback: "#6b6f76",
};

function KindBadge({ kind }) {
  const color = KIND_COLORS[kind];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        color,
        background: `${color}1a`,
      }}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

function teamSizeLabel(min, max) {
  if (min == null && max == null) return "Not specified";
  return `${min ?? "?"} – ${max ?? "?"}`;
}

const QUICK_FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "committed", label: "Committed" },
  { value: "fallback", label: "No trip scheduled" },
];

export default function AdminTripPlanning() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cloningId, setCloningId] = useState(null);
  const [quickFilter, setQuickFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [neverBeenOnly, setNeverBeenOnly] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTripPlanning()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const tripTypes = [...new Set(rows.flatMap((r) => r.tripTypesSupported || []))].sort();

  const visibleRows = rows.filter((row) => {
    if (quickFilter !== "all" && row.kind !== quickFilter) return false;
    if (search && !row.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && !(row.tripTypesSupported || []).includes(typeFilter)) return false;
    if (neverBeenOnly && row.pastTripCount > 0) return false;
    return true;
  });

  async function handleClone(row) {
    if (!row.cloneFromTripId) return;
    setCloningId(row.partnerId);
    try {
      const cloned = await cloneTrip(row.cloneFromTripId);
      navigate(`/admin/trips/${cloned.id}`);
    } catch (err) {
      console.error(err);
      setCloningId(null);
    }
  }

  return (
    <div className="admin-shell">
      <h2>Trip Planning</h2>
      <p style={{ color: "#555" }}>
        Which partner to plan the next trip to — blends what's already scheduled with each partner's general
        trip capacity, so a partner is never dropped from the list just because nothing concrete is on the
        calendar yet.
      </p>

      <div style={{ display: "flex", gap: "0.4rem", marginTop: "1rem" }}>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={quickFilter === f.value ? "btn small" : "btn secondary small"}
            onClick={() => setQuickFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
        <input
          placeholder="Search partner name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Any trip type</option>
          {tripTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontWeight: 400, fontSize: "0.85rem" }}>
          <input type="checkbox" checked={neverBeenOnly} onChange={(e) => setNeverBeenOnly(e.target.checked)} />
          Never been (no past trips)
        </label>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Status</th>
              <th>Dates</th>
              <th>Team</th>
              <th>Past Trips</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.partnerId}>
                <td>
                  <Link to={`/admin/partners/${row.partnerId}`}>{row.displayName}</Link>
                  {row.isRestricted && (
                    <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
                      Restricted partner — won't be publicly discoverable regardless of any trip setting
                    </div>
                  )}
                </td>
                <td>
                  {row.kind === "fallback" ? (
                    <KindBadge kind={row.kind} />
                  ) : (
                    <Link to={`/admin/trips/${row.trip.id}`}>
                      <KindBadge kind={row.kind} />
                    </Link>
                  )}
                </td>
                <td>
                  {row.trip?.startDate || row.trip?.endDate
                    ? `${formatDate(row.trip.startDate) || "?"} – ${formatDate(row.trip.endDate) || "?"}`
                    : "—"}
                </td>
                <td>
                  {row.trip
                    ? `${(row.trip.participants || []).length} / ${row.trip.teamSizeMax ?? row.teamSizeMax ?? "?"} filled`
                    : teamSizeLabel(row.teamSizeMin, row.teamSizeMax)}
                </td>
                <td>
                  {row.pastTripCount} trip{row.pastTripCount === 1 ? "" : "s"}
                  {row.mostRecentPastTripDate && (
                    <div style={{ fontSize: "0.75rem", color: "#888" }}>
                      last {formatDate(row.mostRecentPastTripDate)}
                    </div>
                  )}
                </td>
                <td className="table-actions">
                  {row.kind === "fallback" && (
                    <Link className="btn secondary small" to={`/admin/trips?partnerId=${row.partnerId}`}>
                      Plan a trip
                    </Link>
                  )}
                  {row.cloneFromTripId && (
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={cloningId === row.partnerId}
                      onClick={() => handleClone(row)}
                    >
                      {cloningId === row.partnerId ? "Cloning…" : "Clone last trip"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#888" }}>
                  {rows.length === 0 ? "No partners with trip capacity on file yet." : "No partners match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
