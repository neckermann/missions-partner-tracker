import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAdminMissionaries, fetchAdminOrganizations } from "../api/client.js";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the detail pages' formatDate.
function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

function yearOf(value) {
  return value ? String(value).slice(0, 4) : null;
}

const emptyFilters = {
  entityType: "all", // all | Missionary | Organization
  tripType: "all",
  year: "all",
  minSize: "",
  maxSize: "",
};

export default function AdminTripHistory() {
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

  // Flattens every trip (from every missionary and organization) into one
  // list with a common shape, so the rest of the page doesn't need to know
  // it's really two separate relations (missionTrips vs orgTrips).
  const trips = useMemo(() => {
    const fromMissionaries = missionaries.flatMap((m) =>
      (m.missionTrips || []).map((t) => ({
        ...t,
        entityType: "Missionary",
        entityName: m.displayName,
        entityLink: `/admin/missionaries/${m.id}`,
        size: (t.participants || []).length,
      }))
    );
    const fromOrgs = organizations.flatMap((o) =>
      (o.orgTrips || []).map((t) => ({
        ...t,
        entityType: "Organization",
        entityName: o.name,
        entityLink: `/admin/organizations/${o.id}`,
        size: (t.participants || []).length,
      }))
    );
    return [...fromMissionaries, ...fromOrgs].sort(
      (a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)
    );
  }, [missionaries, organizations]);

  // Filter option lists are built from the trips actually on file (not a
  // hardcoded preset list), so a custom trip type someone typed in still
  // shows up as something you can filter by.
  const tripTypeOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => t.tripType).filter(Boolean))).sort(),
    [trips]
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => yearOf(t.startDate)).filter(Boolean))).sort((a, b) => b - a),
    [trips]
  );

  const filteredTrips = trips.filter((t) => {
    if (filters.entityType !== "all" && t.entityType !== filters.entityType) return false;
    if (filters.tripType !== "all" && t.tripType !== filters.tripType) return false;
    if (filters.year !== "all" && yearOf(t.startDate) !== filters.year) return false;
    if (filters.minSize !== "" && t.size < Number(filters.minSize)) return false;
    if (filters.maxSize !== "" && t.size > Number(filters.maxSize)) return false;
    return true;
  });

  const totalParticipants = filteredTrips.reduce((sum, t) => sum + t.size, 0);

  return (
    <div className="admin-shell">
      <h2>Trip History</h2>

        <div className="admin-section">
          <h3>Filters</h3>
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
                <option value="all">All</option>
                {tripTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Year
              <select value={filters.year} onChange={(e) => updateFilter("year", e.target.value)}>
                <option value="all">All</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Min Team Size
              <input
                type="number"
                min="0"
                value={filters.minSize}
                onChange={(e) => updateFilter("minSize", e.target.value)}
              />
            </label>
            <label>
              Max Team Size
              <input
                type="number"
                min="0"
                value={filters.maxSize}
                onChange={(e) => updateFilter("maxSize", e.target.value)}
              />
            </label>
          </div>
          <button type="button" className="btn secondary small" style={{ marginTop: "1rem" }} onClick={() => setFilters(emptyFilters)}>
            Reset Filters
          </button>
        </div>

        <div className="admin-section">
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Trips</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{filteredTrips.length}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Total Participants</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{totalParticipants}</div>
            </div>
          </div>
        </div>

        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Type</th>
              <th>Trip Type</th>
              <th>Dates</th>
              <th>Team Size</th>
              <th>Leader(s)</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrips.map((trip) => {
              const leaders = (trip.participants || []).filter((p) => p.isLeader).map((p) => p.name);
              return (
                <tr key={trip.id}>
                  <td>
                    <Link to={trip.entityLink}>{trip.entityName}</Link>
                  </td>
                  <td>{trip.entityType}</td>
                  <td>{trip.tripType || "—"}</td>
                  <td>
                    {trip.startDate || trip.endDate
                      ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                      : "—"}
                  </td>
                  <td>{trip.size}</td>
                  <td>{leaders.length ? leaders.join(", ") : "—"}</td>
                  <td>{trip.description || "—"}</td>
                </tr>
              );
            })}
            {filteredTrips.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#888" }}>
                  No trips match these filters.
                </td>
              </tr>
            )}
        </tbody>
      </table>
    </div>
  );
}
