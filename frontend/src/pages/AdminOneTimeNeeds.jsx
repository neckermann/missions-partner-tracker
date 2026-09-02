import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSupportNeeds,
  createSupportNeed,
  updateSupportNeed,
  deleteSupportNeed,
  fetchAdminMissionaries,
  fetchAdminOrganizations,
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

function statusFor(need) {
  if (need.approvedAmount == null) return { label: "Pending Decision", tone: "warn" };
  if (need.approvedAmount === 0) return { label: "Declined", tone: "warn" };
  if (need.approvedAmount < need.requestedAmount) return { label: "Partially Funded", tone: "good" };
  return { label: "Fully Funded", tone: "good" };
}

function entityFor(need) {
  if (need.missionary) return { type: "Missionary", name: need.missionary.displayName, link: `/admin/missionaries/${need.missionary.id}` };
  if (need.organization) return { type: "Organization", name: need.organization.name, link: `/admin/organizations/${need.organization.id}` };
  return { type: "—", name: "—", link: null };
}

const emptyNewNeed = {
  entityKey: "",
  description: "",
  requestedAmount: "",
  requestDate: "",
  notes: "",
};

export default function AdminOneTimeNeeds() {
  const [needs, setNeeds] = useState([]);
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all"); // all | pending | decided
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNeed, setNewNeed] = useState(emptyNewNeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [decision, setDecision] = useState({ approvedAmount: "", approvedDate: "" });

  function reload() {
    fetchSupportNeeds().then(setNeeds).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  const filteredNeeds = needs.filter((need) => {
    if (statusFilter === "pending") return need.approvedAmount == null;
    if (statusFilter === "decided") return need.approvedAmount != null;
    return true;
  });

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newNeed.entityKey) {
      setError("Choose a missionary or organization");
      return;
    }
    const [entityType, entityId] = newNeed.entityKey.split(":");
    setSaving(true);
    try {
      await createSupportNeed({
        missionaryId: entityType === "missionary" ? entityId : undefined,
        organizationId: entityType === "organization" ? entityId : undefined,
        description: newNeed.description.trim(),
        requestedAmount: Number(newNeed.requestedAmount),
        requestDate: newNeed.requestDate,
        notes: newNeed.notes || null,
      });
      setNewNeed(emptyNewNeed);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add need");
    } finally {
      setSaving(false);
    }
  }

  function startDecision(need) {
    setDecidingId(need.id);
    setDecision({ approvedAmount: "", approvedDate: "" });
  }

  async function submitDecision(needId) {
    try {
      await updateSupportNeed(needId, {
        approvedAmount: Number(decision.approvedAmount),
        approvedDate: decision.approvedDate,
      });
      setDecidingId(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record decision");
    }
  }

  async function handleDelete(need) {
    const entity = entityFor(need);
    if (!confirm(`Delete this need request for ${entity.name}? This cannot be undone.`)) return;
    await deleteSupportNeed(need.id);
    reload();
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>One-Time Needs</h2>
          <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? "Cancel" : "+ Add Need"}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
            <div className="form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                Missionary or Organization
                <select
                  value={newNeed.entityKey}
                  onChange={(e) => setNewNeed((f) => ({ ...f, entityKey: e.target.value }))}
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
              <label style={{ gridColumn: "1 / -1" }}>
                Description
                <input
                  value={newNeed.description}
                  onChange={(e) => setNewNeed((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. One-time gift to help a family in their congregation"
                  required
                />
              </label>
              <label>
                Requested Amount ($)
                <input
                  type="number"
                  min="0"
                  value={newNeed.requestedAmount}
                  onChange={(e) => setNewNeed((f) => ({ ...f, requestedAmount: e.target.value }))}
                  required
                />
              </label>
              <label>
                Request Date
                <input
                  type="date"
                  value={newNeed.requestDate}
                  onChange={(e) => setNewNeed((f) => ({ ...f, requestDate: e.target.value }))}
                  required
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Notes
                <input value={newNeed.notes} onChange={(e) => setNewNeed((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
            <div style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving..." : "Add Need"}
              </button>
            </div>
          </form>
        )}

        <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Show:
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All</option>
            <option value="pending">Pending decision</option>
            <option value="decided">Decided</option>
          </select>
        </div>

        {filteredNeeds.map((need) => {
          const entity = entityFor(need);
          const status = statusFor(need);
          return (
            <div key={need.id} className="repeatable-row" style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <span className={`status-pill ${status.tone}`} style={{ marginRight: "0.5rem" }}>
                    {status.label}
                  </span>
                  {entity.link ? (
                    <Link to={entity.link}>
                      {entity.name} ({entity.type})
                    </Link>
                  ) : (
                    <span>{entity.name}</span>
                  )}
                </div>
                <button className="btn danger small" onClick={() => handleDelete(need)}>
                  Delete
                </button>
              </div>

              <p style={{ margin: "0.5rem 0" }}>{need.description}</p>

              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Requested</div>
                  <div>{formatCurrency(need.requestedAmount)} on {formatDate(need.requestDate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Approved</div>
                  <div>
                    {need.approvedAmount != null
                      ? `${formatCurrency(need.approvedAmount)} on ${formatDate(need.approvedDate)}`
                      : "Not yet decided"}
                  </div>
                </div>
                {need.notes && (
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Notes</div>
                    <div>{need.notes}</div>
                  </div>
                )}
              </div>

              {need.approvedAmount == null && (
                <div style={{ marginTop: "0.75rem" }}>
                  {decidingId === need.id ? (
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                      <label>
                        Approved Amount ($)
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
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => submitDecision(need.id)}
                        disabled={decision.approvedAmount === "" || !decision.approvedDate}
                      >
                        Save Decision
                      </button>
                      <button type="button" className="btn secondary small" onClick={() => setDecidingId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn secondary small" onClick={() => startDecision(need)}>
                      Record Decision
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      {filteredNeeds.length === 0 && (
        <p style={{ color: "#888", marginTop: "1rem" }}>No needs on file.</p>
      )}
    </div>
  );
}
