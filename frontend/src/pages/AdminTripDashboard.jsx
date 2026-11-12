import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTripDashboard } from "../api/client.js";
import { formatDate } from "../utils/format.js";

// New (#252), §12 -- read-only multi-trip overview. Trips often overlap
// in time, so this lists every active one together rather than requiring
// a church to check each one's own page separately.
export default function AdminTripDashboard() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetchTripDashboard().then(setRows).catch(console.error);
  }, []);

  function daysUntil(startDate) {
    if (!startDate) return null;
    const days = Math.ceil((new Date(startDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days;
  }

  return (
    <div className="admin-shell">
      <h2>Trips Dashboard</h2>
      <p style={{ color: "#555" }}>Every trip currently planning, accepting applications, or closed — soonest-departing first.</p>
      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Trip</th>
            <th>Dates</th>
            <th>Days until departure</th>
            <th>Team filled</th>
            <th>Raised</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const days = daysUntil(r.startDate);
            return (
              <tr key={r.id}>
                <td>
                  <Link to={`/admin/trips/${r.id}`}>{r.name || r.type || "Trip"}</Link>
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>{r.partner?.displayName}</div>
                </td>
                <td>
                  {r.startDate || r.endDate
                    ? `${formatDate(r.startDate) || "?"} – ${formatDate(r.endDate) || "?"}`
                    : "—"}
                </td>
                <td>{days != null ? `${days} days` : "—"}</td>
                <td>
                  {r.teamFilled} / {r.teamSizeMax ?? "?"}
                </td>
                <td>
                  ${r.raised}
                  {r.supportRaisingGoal ? ` / $${r.supportRaisingGoal}` : ""}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#888" }}>
                No active trips right now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
