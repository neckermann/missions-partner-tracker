import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchAdminMissionaries,
  fetchAdminOrganizations,
  createSupportEntry,
  deleteSupportEntry,
} from "../api/client.js";

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

const todayInputValue = () => new Date().toISOString().slice(0, 10);
const emptyNewEntry = { entityKey: "", amount: "", effectiveDate: todayInputValue(), notes: "" };

export default function AdminMonthlySupport() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState(emptyNewEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [historyFor, setHistoryFor] = useState(null); // link of the row whose full history is expanded, or null
  const navigate = useNavigate();

  function reload() {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }

  useEffect(() => {
    reload();
  }, []);

  // The API orders supportEntries by effectiveDate descending, so the first
  // entry (if any) is always the current amount. Every entity's full
  // history comes along for free in the same relation -- see the "History"
  // expand row below, no separate fetch needed.
  const rows = [
    ...missionaries.map((m) => ({
      type: "Missionary",
      name: m.displayName,
      field: m.fieldDisplayName,
      archived: m.archived,
      current: m.supportEntries?.[0],
      entries: m.supportEntries || [],
      link: `/admin/missionaries/${m.id}`,
    })),
    ...organizations.map((o) => ({
      type: "Organization",
      name: o.name,
      field: o.fieldDisplayName,
      archived: o.archived,
      current: o.supportEntries?.[0],
      entries: o.supportEntries || [],
      link: `/admin/organizations/${o.id}`,
    })),
  ]
    .filter((r) => r.current) // only entities with a support amount on file
    .filter((r) => includeArchived || !r.archived)
    .sort((a, b) => b.current.amount - a.current.amount);

  const total = rows.reduce((sum, r) => sum + r.current.amount, 0);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newEntry.entityKey) {
      setError("Choose a missionary or organization");
      return;
    }
    const [entityType, entityId] = newEntry.entityKey.split(":");
    setSaving(true);
    try {
      await createSupportEntry({
        missionaryId: entityType === "missionary" ? entityId : null,
        organizationId: entityType === "organization" ? entityId : null,
        amount: newEntry.amount,
        effectiveDate: newEntry.effectiveDate,
        notes: newEntry.notes || null,
      });
      setNewEntry(emptyNewEntry);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save support entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(entry) {
    if (!confirm(`Delete the ${formatCurrency(entry.amount)} entry effective ${formatDate(entry.effectiveDate)}? This cannot be undone.`))
      return;
    await deleteSupportEntry(entry.id);
    reload();
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Monthly Support</h2>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
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
            <button
              className="btn"
              onClick={() => {
                setShowAddForm((v) => !v);
                setError("");
              }}
            >
              {showAddForm ? "Cancel" : "+ Add Support Entry"}
            </button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
            <div className="form-grid">
              <label
                style={{ gridColumn: "1 / -1" }}
                title="A new support amount takes effect as of the date below -- it doesn't overwrite prior entries, which stay on file as history."
              >
                Missionary or Organization
                <select
                  value={newEntry.entityKey}
                  onChange={(e) => setNewEntry((f) => ({ ...f, entityKey: e.target.value }))}
                  required
                >
                  <option value="">Select one...</option>
                  <optgroup label="Missionaries">
                    {missionaries.map((m) => (
                      <option key={m.id} value={`missionary:${m.id}`}>
                        {m.displayName}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Organizations">
                    {organizations.map((o) => (
                      <option key={o.id} value={`organization:${o.id}`}>
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label>
                Monthly Amount (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={newEntry.amount}
                  onChange={(e) => setNewEntry((f) => ({ ...f, amount: e.target.value }))}
                  required
                />
              </label>
              <label>
                Effective Date
                <input
                  type="date"
                  value={newEntry.effectiveDate}
                  onChange={(e) => setNewEntry((f) => ({ ...f, effectiveDate: e.target.value }))}
                  required
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Notes
                <input value={newEntry.notes} onChange={(e) => setNewEntry((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
            <div style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving..." : "Save Entry"}
              </button>
            </div>
          </form>
        )}

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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.link}>
                <tr onClick={() => navigate(r.link)} style={{ cursor: "pointer" }} title="Click to view details">
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.field}</td>
                  <td>{formatCurrency(r.current.amount)}</td>
                  <td>{formatDate(r.current.effectiveDate)}</td>
                  <td className="table-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => setHistoryFor(historyFor === r.link ? null : r.link)}
                      title="View and correct past support entries for this partner"
                    >
                      {historyFor === r.link ? "Hide History" : `History (${r.entries.length})`}
                    </button>
                  </td>
                </tr>
                {historyFor === r.link && (
                  <tr onClick={(e) => e.stopPropagation()}>
                    <td colSpan={6}>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Amount</th>
                            <th>Effective Date</th>
                            <th>Notes</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.entries.map((entry) => (
                            <tr key={entry.id}>
                              <td>{formatCurrency(entry.amount)}</td>
                              <td>{formatDate(entry.effectiveDate)}</td>
                              <td>{entry.notes || "—"}</td>
                              <td className="table-actions">
                                <button
                                  type="button"
                                  className="btn danger small"
                                  onClick={() => handleDeleteEntry(entry)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#888" }}>
                  No support entries on file yet.
                </td>
              </tr>
            )}
          </tbody>
      </table>
    </div>
  );
}
