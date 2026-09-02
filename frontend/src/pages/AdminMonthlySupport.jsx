import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAdminMissionaries, fetchAdminOrganizations } from "../api/client.js";

function formatCurrency(amount) {
  if (amount == null) return "—";
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the detail pages' formatDate.
function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function AdminMonthlySupport() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  // The API orders supportEntries by effectiveDate descending, so the first
  // entry (if any) is always the current amount.
  const rows = [
    ...missionaries.map((m) => ({
      type: "Missionary",
      name: m.displayName,
      field: m.fieldDisplayName,
      archived: m.archived,
      current: m.supportEntries?.[0],
      link: `/admin/missionaries/${m.id}`,
    })),
    ...organizations.map((o) => ({
      type: "Organization",
      name: o.name,
      field: o.fieldDisplayName,
      archived: o.archived,
      current: o.supportEntries?.[0],
      link: `/admin/organizations/${o.id}`,
    })),
  ]
    .filter((r) => r.current) // only entities with a support amount on file
    .filter((r) => includeArchived || !r.archived)
    .sort((a, b) => b.current.amount - a.current.amount);

  const total = rows.reduce((sum, r) => sum + r.current.amount, 0);

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Monthly Support</h2>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Include archived
            </label>
          </div>
        </div>

        <div className="admin-section" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
            <span style={{ fontSize: "0.85rem", color: "#555" }}>Total monthly support ({rows.length}):</span>
            <span style={{ fontSize: "1.3rem", fontWeight: 700 }}>{formatCurrency(total)}</span>
          </div>
        </div>

        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Field / Region</th>
              <th>Monthly Amount</th>
              <th>Effective Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.link} onClick={() => navigate(r.link)} style={{ cursor: "pointer" }} title="Click to view details">
                <td>{r.name}</td>
                <td>{r.type}</td>
                <td>{r.field}</td>
                <td>{formatCurrency(r.current.amount)}</td>
                <td>{formatDate(r.current.effectiveDate)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#888" }}>
                  No support entries on file yet.
                </td>
              </tr>
            )}
          </tbody>
      </table>
    </div>
  );
}
