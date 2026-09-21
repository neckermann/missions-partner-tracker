import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPartners, fetchSupportEntries, createSupportEntry, deleteSupportEntry } from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";

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
const emptyNewEntry = { partnerId: "", amount: "", effectiveDate: todayInputValue(), notes: "" };

export default function AdminMonthlySupport() {
  const [partners, setPartners] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState(emptyNewEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The partner whose full history is expanded, plus that history. It's
  // fetched on demand rather than arriving with every row: the summary
  // list carries only each partner's *current* amount, which is all the
  // table itself shows.
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const navigate = useNavigate();

  function reload() {
    fetchPartners().then(setPartners).catch(console.error);
    if (historyFor) loadHistory(historyFor);
  }

  useEffect(() => {
    reload();
  }, []);

  function loadHistory(partnerId) {
    fetchSupportEntries({ partnerId }).then(setHistory).catch(console.error);
  }

  function toggleHistory(partnerId) {
    if (historyFor === partnerId) {
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    setHistoryFor(partnerId);
    setHistory([]);
    loadHistory(partnerId);
  }

  // fetchPartners returns each partner's latest support entry (the summary
  // select takes 1, ordered by effectiveDate desc), which is exactly what
  // this table shows.
  const rows = partners
    .map((p) => ({
      id: p.id,
      type: p.kind === "organization" ? "Organization" : "Missionary",
      name: p.displayName,
      field: p.fieldDisplayName,
      archived: p.archived,
      current: p.supportEntries?.[0],
      link: `/admin/partners/${p.id}`,
    }))
    .filter((r) => r.current) // only partners with a support amount on file
    .filter((r) => includeArchived || !r.archived)
    .sort((a, b) => b.current.amount - a.current.amount);

  const total = rows.reduce((sum, r) => sum + r.current.amount, 0);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newEntry.partnerId) {
      setError("Choose a partner");
      return;
    }
    setSaving(true);
    try {
      await createSupportEntry({
        partnerId: newEntry.partnerId,
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
    if (
      !confirm(
        `Delete the ${formatCurrency(entry.amount)} entry effective ${formatDate(entry.effectiveDate)}? This cannot be undone.`
      )
    )
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
              Partner
              <PartnerSelect
                partners={partners}
                value={newEntry.partnerId}
                onChange={(partnerId) => setNewEntry((f) => ({ ...f, partnerId }))}
                required
              />
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
              <input
                value={newEntry.notes}
                onChange={(e) => setNewEntry((f) => ({ ...f, notes: e.target.value }))}
              />
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
            <React.Fragment key={r.id}>
              <tr
                onClick={() => navigate(r.link)}
                style={{ cursor: "pointer" }}
                title="Click to view details"
              >
                <td>{r.name}</td>
                <td>{r.type}</td>
                <td>{r.field}</td>
                <td>{formatCurrency(r.current.amount)}</td>
                <td>{formatDate(r.current.effectiveDate)}</td>
                <td className="table-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => toggleHistory(r.id)}
                    title="View and correct past support entries for this partner"
                  >
                    {historyFor === r.id ? "Hide History" : "History"}
                  </button>
                </td>
              </tr>
              {historyFor === r.id && (
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
                        {history.map((entry) => (
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
