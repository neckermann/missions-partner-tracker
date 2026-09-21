import React, { useState } from "react";
import {
  createSupportEntry,
  deleteSupportEntry,
  createSupportNeed,
  updateSupportNeed,
  deleteSupportNeed,
} from "../../api/client.js";

// Monthly support and one-time needs for one partner, editable here rather
// than only from the consolidated admin pages. Same endpoints either way.
//
// Support entries have no edit: an entry records what the amount was set to
// as of a date, like a line in a ledger, so correcting one means deleting it
// and adding another. The API has no update route for them at all.

function formatCurrency(amount) {
  if (amount == null) return null;
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);
const emptyEntry = { amount: "", effectiveDate: todayInputValue(), notes: "" };
const emptyNeed = { description: "", requestedAmount: "", requestDate: todayInputValue(), notes: "" };

function needStatus(need) {
  if (need.approvedAmount == null) return { label: "Pending Decision", tone: "warn" };
  if (need.approvedAmount === 0) return { label: "Declined", tone: "warn" };
  if (need.approvedAmount < need.requestedAmount) return { label: "Partially Funded", tone: "good" };
  return { label: "Fully Funded", tone: "good" };
}

export default function PartnerFinancialSection({
  partnerId,
  supportEntries,
  needRequests,
  showMonthlySupport,
  showOneTimeNeeds,
  onChange,
}) {
  const [addingEntry, setAddingEntry] = useState(false);
  const [entry, setEntry] = useState(emptyEntry);
  const [addingNeed, setAddingNeed] = useState(false);
  const [need, setNeed] = useState(emptyNeed);
  const [decidingId, setDecidingId] = useState(null);
  const [decision, setDecision] = useState({ approvedAmount: "", approvedDate: todayInputValue() });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const current = supportEntries?.[0];

  function fail(err, fallback) {
    setError(err.response?.data?.error?.[0]?.message || err.response?.data?.error || fallback);
  }

  async function submitEntry(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createSupportEntry({
        partnerId,
        amount: entry.amount,
        effectiveDate: entry.effectiveDate,
        notes: entry.notes || null,
      });
      setEntry(emptyEntry);
      setAddingEntry(false);
      await onChange();
    } catch (err) {
      fail(err, "Failed to add support entry");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(row) {
    if (
      !confirm(`Delete the ${formatCurrency(row.amount)} entry effective ${formatDate(row.effectiveDate)}?`)
    )
      return;
    await deleteSupportEntry(row.id);
    await onChange();
  }

  async function submitNeed(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createSupportNeed({
        partnerId,
        description: need.description.trim(),
        requestedAmount: Number(need.requestedAmount),
        requestDate: need.requestDate,
        notes: need.notes || null,
      });
      setNeed(emptyNeed);
      setAddingNeed(false);
      await onChange();
    } catch (err) {
      fail(err, "Failed to add need");
    } finally {
      setSaving(false);
    }
  }

  async function submitDecision(id) {
    setSaving(true);
    setError("");
    try {
      await updateSupportNeed(id, {
        approvedAmount: Number(decision.approvedAmount),
        approvedDate: decision.approvedDate,
      });
      setDecidingId(null);
      await onChange();
    } catch (err) {
      fail(err, "Failed to record the decision");
    } finally {
      setSaving(false);
    }
  }

  async function removeNeed(row) {
    if (!confirm(`Delete this need? This cannot be undone.`)) return;
    await deleteSupportNeed(row.id);
    await onChange();
  }

  return (
    <>
      {showMonthlySupport && (
        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ flex: 1, marginBottom: 0 }}>Financial Support</h3>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setAddingEntry((v) => !v)}
              title="A new amount takes effect as of its date -- earlier entries stay on file as history."
            >
              {addingEntry ? "Cancel" : "+ Add Support Entry"}
            </button>
          </div>

          <div style={{ margin: "1rem 0" }}>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
              Current Monthly Support
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              {formatCurrency(current?.amount) ?? "—"}
            </div>
          </div>

          {addingEntry && (
            <form onSubmit={submitEntry} style={{ marginBottom: "1rem" }}>
              <div className="form-grid">
                <label>
                  Monthly Amount (USD)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={entry.amount}
                    onChange={(e) => setEntry((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Effective Date
                  <input
                    type="date"
                    value={entry.effectiveDate}
                    onChange={(e) => setEntry((f) => ({ ...f, effectiveDate: e.target.value }))}
                    required
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Notes
                  <input
                    value={entry.notes}
                    onChange={(e) => setEntry((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>
              </div>
              <button type="submit" className="btn small" style={{ marginTop: "0.75rem" }} disabled={saving}>
                {saving ? "Saving..." : "Add Entry"}
              </button>
            </form>
          )}

          {supportEntries?.length > 0 ? (
            supportEntries.map((row) => (
              <div key={row.id} className="repeatable-row">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                    <strong>{formatCurrency(row.amount)}</strong>
                    <span style={{ color: "#666" }}>effective {formatDate(row.effectiveDate)}</span>
                    {row.notes && <span style={{ color: "#666" }}>{row.notes}</span>}
                  </div>
                  <div className="table-actions">
                    <button type="button" className="btn danger small" onClick={() => removeEntry(row)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: "#888" }}>No support history on file.</p>
          )}
        </div>
      )}

      {showOneTimeNeeds && (
        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ flex: 1, marginBottom: 0 }}>One-Time Needs</h3>
            <button type="button" className="btn secondary small" onClick={() => setAddingNeed((v) => !v)}>
              {addingNeed ? "Cancel" : "+ Add Need"}
            </button>
          </div>

          {addingNeed && (
            <form onSubmit={submitNeed} style={{ margin: "1rem 0" }}>
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Description
                  <input
                    value={need.description}
                    onChange={(e) => setNeed((f) => ({ ...f, description: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Requested Amount (USD)
                  <input
                    type="number"
                    min="0"
                    value={need.requestedAmount}
                    onChange={(e) => setNeed((f) => ({ ...f, requestedAmount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Request Date
                  <input
                    type="date"
                    value={need.requestDate}
                    onChange={(e) => setNeed((f) => ({ ...f, requestDate: e.target.value }))}
                    required
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Notes
                  <input
                    value={need.notes}
                    onChange={(e) => setNeed((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>
              </div>
              <button type="submit" className="btn small" style={{ marginTop: "0.75rem" }} disabled={saving}>
                {saving ? "Saving..." : "Add Need"}
              </button>
            </form>
          )}

          {needRequests?.length > 0 ? (
            needRequests.map((row) => {
              const status = needStatus(row);
              return (
                <div key={row.id} className="repeatable-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <span className={`status-pill ${status.tone}`}>{status.label}</span>
                      <div style={{ marginTop: "0.4rem" }}>{row.description}</div>
                      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                        Requested {formatCurrency(row.requestedAmount)} on {formatDate(row.requestDate)}
                        {row.approvedAmount != null &&
                          ` · Approved ${formatCurrency(row.approvedAmount)}${
                            row.approvedDate ? ` on ${formatDate(row.approvedDate)}` : ""
                          }`}
                      </div>
                      {row.notes && (
                        <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                          {row.notes}
                        </div>
                      )}
                    </div>
                    <div className="table-actions">
                      {row.approvedAmount == null && (
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => {
                            setDecidingId(decidingId === row.id ? null : row.id);
                            setDecision({ approvedAmount: "", approvedDate: todayInputValue() });
                          }}
                        >
                          {decidingId === row.id ? "Cancel" : "Record Decision"}
                        </button>
                      )}
                      <button type="button" className="btn danger small" onClick={() => removeNeed(row)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {decidingId === row.id && (
                    <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                      <label title="Enter 0 to record that the request was declined.">
                        Approved Amount (USD)
                        <input
                          type="number"
                          min="0"
                          value={decision.approvedAmount}
                          onChange={(e) => setDecision((d) => ({ ...d, approvedAmount: e.target.value }))}
                        />
                      </label>
                      <label>
                        Approved Date
                        <input
                          type="date"
                          value={decision.approvedDate}
                          onChange={(e) => setDecision((d) => ({ ...d, approvedDate: e.target.value }))}
                        />
                      </label>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => submitDecision(row.id)}
                          disabled={saving}
                        >
                          Save Decision
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p style={{ color: "#888" }}>No needs on file.</p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
    </>
  );
}
