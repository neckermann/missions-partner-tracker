import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAdminMissionaries, fetchAdminOrganizations } from "../api/client.js";
import { matchesSearch } from "../utils/search.js";

// Forward-looking capacity search — "who could host a trip like this" —
// as opposed to /admin/trips, which is a log of trips that already
// happened. Reads the same tripTeamSizeMin/Max/tripTypesSupported/
// tripSeasonNotes/tripLogisticsNotes fields shown in each partner's own
// "Trip Capacity" section; nothing new to fetch.
const emptyFilters = {
  entityType: "all", // all | Missionary | Organization
  tripType: "all",
  teamSize: "",
  field: "",
  recency: "any", // any | never | over1y | over2y
  includeArchived: false,
};

function teamSizeLabel(min, max) {
  if (min == null && max == null) return "Not specified";
  return `${min ?? "?"} – ${max ?? "?"}`;
}

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the other trip pages' formatDate.
function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

// The most recent trip (by startDate) out of an entity's trip list, plus
// how many trips total — drives the "Last Trip" column and the "Last
// Visited" recency filter below.
function lastTripInfo(trips) {
  const dated = (trips || []).filter((t) => t.startDate);
  const lastDate = dated.length
    ? dated.reduce((latest, t) => (new Date(t.startDate) > new Date(latest) ? t.startDate : latest), dated[0].startDate)
    : null;
  return { lastDate, count: trips?.length || 0 };
}

// "Never visited" counts as passing "over 1/2 years ago" too — it's even
// more overdue than a dated-but-old trip, not a non-match.
function passesRecency(lastDate, recency) {
  if (recency === "any") return true;
  if (recency === "never") return !lastDate;
  if (!lastDate) return true;
  const years = (Date.now() - new Date(lastDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (recency === "over1y") return years >= 1;
  if (recency === "over2y") return years >= 2;
  return true;
}

// A blank tripTeamSizeMin/Max or empty tripTypesSupported means the field
// was never filled in, not that the partner can't host — excluding those
// records would silently hide real opportunities just because the data
// entry is incomplete. So "unspecified" always counts as a possible match
// and is called out in the Fit column instead, letting the admin judge for
// themselves rather than the filter deciding for them.
function fitFor(entity, filters) {
  const notes = [];
  let sizeFit = true;
  let typeFit = true;

  if (filters.teamSize !== "") {
    const size = Number(filters.teamSize);
    if (entity.tripTeamSizeMin == null && entity.tripTeamSizeMax == null) {
      notes.push("Team size not specified");
    } else {
      if (entity.tripTeamSizeMin != null && size < entity.tripTeamSizeMin) sizeFit = false;
      if (entity.tripTeamSizeMax != null && size > entity.tripTeamSizeMax) sizeFit = false;
    }
  }

  if (filters.tripType !== "all") {
    if (!entity.tripTypesSupported?.length) {
      notes.push("Trip types not specified");
    } else {
      typeFit = entity.tripTypesSupported.includes(filters.tripType);
    }
  }

  return { matches: sizeFit && typeFit, notes };
}

export default function AdminTripOpportunities() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  const entities = useMemo(() => {
    const fromMissionaries = missionaries.map((m) => ({
      id: m.id,
      entityType: "Missionary",
      name: m.displayName,
      link: `/admin/missionaries/${m.id}`,
      field: m.fieldDisplayName,
      archived: m.archived,
      tripTeamSizeMin: m.tripTeamSizeMin,
      tripTeamSizeMax: m.tripTeamSizeMax,
      tripTypesSupported: m.tripTypesSupported || [],
      tripSeasonNotes: m.tripSeasonNotes,
      tripLogisticsNotes: m.tripLogisticsNotes,
      lastTrip: lastTripInfo(m.missionTrips),
    }));
    const fromOrgs = organizations.map((o) => ({
      id: o.id,
      entityType: "Organization",
      name: o.name,
      link: `/admin/organizations/${o.id}`,
      field: o.fieldDisplayName,
      archived: o.archived,
      tripTeamSizeMin: o.tripTeamSizeMin,
      tripTeamSizeMax: o.tripTeamSizeMax,
      tripTypesSupported: o.tripTypesSupported || [],
      tripSeasonNotes: o.tripSeasonNotes,
      tripLogisticsNotes: o.tripLogisticsNotes,
      lastTrip: lastTripInfo(o.orgTrips),
    }));
    return [...fromMissionaries, ...fromOrgs].sort((a, b) => a.name.localeCompare(b.name));
  }, [missionaries, organizations]);

  const tripTypeOptions = useMemo(
    () => Array.from(new Set(entities.flatMap((e) => e.tripTypesSupported))).sort(),
    [entities]
  );

  const results = entities
    .filter((e) => filters.includeArchived || !e.archived)
    .filter((e) => filters.entityType === "all" || e.entityType === filters.entityType)
    .filter((e) => matchesSearch(filters.field, e.field))
    .filter((e) => passesRecency(e.lastTrip.lastDate, filters.recency))
    .map((e) => ({ ...e, fit: fitFor(e, filters) }))
    .filter((e) => e.fit.matches);

  return (
    <div className="admin-shell">
      <h2>Trip Opportunities</h2>
      <p style={{ color: "#555" }}>
          Find missionaries and organizations who can host a trip you're planning, based on the
          team size and trip types they say they support.
        </p>

        <div className="admin-section">
          <h3>Search</h3>
          <div className="form-grid">
            <label>
              Partner Type
              <select value={filters.entityType} onChange={(e) => updateFilter("entityType", e.target.value)}>
                <option value="all">All</option>
                <option value="Missionary">Missionary</option>
                <option value="Organization">Organization</option>
              </select>
            </label>
            <label>
              Trip Type
              <select value={filters.tripType} onChange={(e) => updateFilter("tripType", e.target.value)}>
                <option value="all">Any</option>
                {tripTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Team Size
              <input
                type="number"
                min="0"
                placeholder="e.g. 8"
                value={filters.teamSize}
                onChange={(e) => updateFilter("teamSize", e.target.value)}
              />
            </label>
            <label>
              Field / Region contains
              <input value={filters.field} onChange={(e) => updateFilter("field", e.target.value)} placeholder="e.g. Kenya" />
            </label>
            <label>
              Last Visited
              <select value={filters.recency} onChange={(e) => updateFilter("recency", e.target.value)}>
                <option value="any">Any</option>
                <option value="never">Never</option>
                <option value="over1y">Over 1 year ago</option>
                <option value="over2y">Over 2 years ago</option>
              </select>
            </label>
          </div>
          <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
            <label>
              <input
                type="checkbox"
                checked={filters.includeArchived}
                onChange={(e) => updateFilter("includeArchived", e.target.checked)}
              />
              Include archived
            </label>
          </div>
          <button type="button" className="btn secondary small" style={{ marginTop: "1rem" }} onClick={() => setFilters(emptyFilters)}>
            Reset
          </button>
        </div>

        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Type</th>
              <th>Field / Region</th>
              <th>Last Trip</th>
              <th>Team Size</th>
              <th>Trip Types Supported</th>
              <th>Season Notes</th>
              <th>Logistics Notes</th>
            </tr>
          </thead>
          <tbody>
            {results.map((e) => (
              <tr key={`${e.entityType}-${e.id}`}>
                <td>
                  <Link to={e.link}>{e.name}</Link>
                  {e.fit.notes.length > 0 && (
                    <div style={{ fontSize: "0.75rem", color: "#b45309" }}>{e.fit.notes.join(" · ")}</div>
                  )}
                </td>
                <td>{e.entityType}</td>
                <td>{e.field || "—"}</td>
                <td>
                  {e.lastTrip.lastDate ? (
                    <>
                      {formatDate(e.lastTrip.lastDate)}
                      <div style={{ fontSize: "0.75rem", color: "#888" }}>
                        {e.lastTrip.count} trip{e.lastTrip.count === 1 ? "" : "s"} total
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "#aaa" }}>Never</span>
                  )}
                </td>
                <td>{teamSizeLabel(e.tripTeamSizeMin, e.tripTeamSizeMax)}</td>
                <td>{e.tripTypesSupported.length ? e.tripTypesSupported.join(", ") : "—"}</td>
                <td>{e.tripSeasonNotes || "—"}</td>
                <td>{e.tripLogisticsNotes || "—"}</td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: "#888" }}>
                  No matches for these filters.
                </td>
              </tr>
            )}
        </tbody>
      </table>
    </div>
  );
}
