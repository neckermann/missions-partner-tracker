import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPrayerRequests,
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchAdminMissionaries,
  fetchAdminOrganizations,
} from "../api/client.js";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the other admin pages' formatDate.
function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

function entityFor(request) {
  if (request.missionary) return { type: "Missionary", name: request.missionary.displayName, link: `/admin/missionaries/${request.missionary.id}` };
  if (request.organization) return { type: "Organization", name: request.organization.name, link: `/admin/organizations/${request.organization.id}` };
  return { type: "—", name: "—", link: null };
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const emptyNewRequest = {
  entityKey: "",
  category: "long_term",
  requestText: "",
  dateReceived: todayInputValue(),
  isPublic: false,
  untracked: false,
  notes: "",
};

// Same shape as AdminOneTimeNeeds.jsx, but deliberately without that
// page's "Pending Decision" warning-toned status pill -- an open prayer
// request isn't a problem to flag, see the PrayerRequest model comment
// in schema.prisma. The only status called out here at all is
// "Answered", as a quiet note, not a checklist item.
export default function AdminPrayerRequests() {
  const [requests, setRequests] = useState([]);
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("all"); // all | short_term | long_term
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answeringId, setAnsweringId] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });

  function reload() {
    fetchPrayerRequests().then(setRequests).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  const filteredRequests = requests.filter((r) => categoryFilter === "all" || r.category === categoryFilter);
  const answeredCount = requests.filter((r) => r.status === "answered").length;

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newRequest.entityKey) {
      setError("Choose a missionary or organization");
      return;
    }
    const [entityType, entityId] = newRequest.entityKey.split(":");
    setSaving(true);
    try {
      await createPrayerRequest({
        missionaryId: entityType === "missionary" ? entityId : undefined,
        organizationId: entityType === "organization" ? entityId : undefined,
        category: newRequest.category,
        requestText: newRequest.requestText.trim(),
        dateReceived: newRequest.dateReceived,
        isPublic: newRequest.category === "long_term" ? newRequest.isPublic : false,
        status: newRequest.untracked ? "untracked" : "ongoing",
        notes: newRequest.notes || null,
      });
      setNewRequest(emptyNewRequest);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add prayer request");
    } finally {
      setSaving(false);
    }
  }

  function startAnswer(request) {
    setAnsweringId(request.id);
    setAnswer({ dateAnswered: todayInputValue(), answeredNote: "" });
  }

  async function submitAnswer(id) {
    try {
      await updatePrayerRequest(id, {
        status: "answered",
        dateAnswered: answer.dateAnswered,
        answeredNote: answer.answeredNote || null,
      });
      setAnsweringId(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record the answer");
    }
  }

  async function handleDelete(request) {
    const entity = entityFor(request);
    if (!confirm(`Delete this prayer request for ${entity.name}? This cannot be undone.`)) return;
    await deletePrayerRequest(request.id);
    reload();
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Prayer Requests</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Prayer Request"}
        </button>
      </div>
      <p style={{ color: "#666", marginTop: "0.25rem" }}>
        {requests.length} on file · {answeredCount} answered so far
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Missionary or Organization
              <select
                value={newRequest.entityKey}
                onChange={(e) => setNewRequest((f) => ({ ...f, entityKey: e.target.value }))}
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
              Category
              <select
                value={newRequest.category}
                onChange={(e) => setNewRequest((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="long_term">Long-term (can be shared publicly)</option>
                <option value="short_term">Short-term (admin-only)</option>
              </select>
            </label>
            <label>
              Date Received
              <input
                type="date"
                value={newRequest.dateReceived}
                onChange={(e) => setNewRequest((f) => ({ ...f, dateReceived: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Prayer Request
              <textarea
                rows={2}
                value={newRequest.requestText}
                onChange={(e) => setNewRequest((f) => ({ ...f, requestText: e.target.value }))}
                required
              />
            </label>
            {newRequest.category === "long_term" && (
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={newRequest.isPublic}
                    onChange={(e) => setNewRequest((f) => ({ ...f, isPublic: e.target.checked }))}
                  />
                  Show on public profile &amp; booklet
                </label>
              </div>
            )}
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={newRequest.untracked}
                  onChange={(e) => setNewRequest((f) => ({ ...f, untracked: e.target.checked }))}
                />
                Not tracking this one for a specific answer
              </label>
            </div>
            <label style={{ gridColumn: "1 / -1" }}>
              Admin Notes (optional, never shown publicly)
              <input value={newRequest.notes} onChange={(e) => setNewRequest((f) => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Add Prayer Request"}
            </button>
          </div>
        </form>
      )}

      <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
          Show:
        </label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="all">All</option>
          <option value="long_term">Long-term</option>
          <option value="short_term">Short-term</option>
        </select>
      </div>

      {filteredRequests.map((request) => {
        const entity = entityFor(request);
        return (
          <div key={request.id} className="repeatable-row" style={{ marginTop: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                {entity.link ? (
                  <Link to={entity.link}>
                    {entity.name} ({entity.type})
                  </Link>
                ) : (
                  <span>{entity.name}</span>
                )}
              </div>
              <div className="table-actions">
                {request.status !== "answered" && (
                  <button type="button" className="btn secondary small" onClick={() => startAnswer(request)}>
                    Record Answer
                  </button>
                )}
                <button type="button" className="btn danger small" onClick={() => handleDelete(request)}>
                  Delete
                </button>
              </div>
            </div>

            <p style={{ margin: "0.5rem 0" }}>{request.requestText}</p>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Received</div>
                <div>
                  {formatDate(request.dateReceived)} · {request.category === "long_term" ? "Long-term" : "Short-term"}
                  {request.category === "long_term" && request.isPublic && " · Public"}
                </div>
              </div>
              {/* Same principle as PrayerRequestSection.jsx: only "answered"
                  gets a callout here. "ongoing"/"untracked" show nothing. */}
              {request.status === "answered" && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Answered</div>
                  <div style={{ color: "#2a5d3c" }}>
                    {formatDate(request.dateAnswered)}
                    {request.answeredNote && ` — ${request.answeredNote}`}
                  </div>
                </div>
              )}
              {request.notes && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Notes</div>
                  <div>{request.notes}</div>
                </div>
              )}
            </div>

            {answeringId === request.id && (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <label>
                  Date Answered
                  <input
                    type="date"
                    value={answer.dateAnswered}
                    onChange={(e) => setAnswer((a) => ({ ...a, dateAnswered: e.target.value }))}
                  />
                </label>
                <label style={{ flex: 1, minWidth: "200px" }}>
                  How was it answered? (optional)
                  <input
                    value={answer.answeredNote}
                    onChange={(e) => setAnswer((a) => ({ ...a, answeredNote: e.target.value }))}
                    placeholder="e.g. The clinic opened safely in March"
                  />
                </label>
                <button type="button" className="btn small" onClick={() => submitAnswer(request.id)}>
                  Save
                </button>
                <button type="button" className="btn secondary small" onClick={() => setAnsweringId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {filteredRequests.length === 0 && (
        <p style={{ color: "#888", marginTop: "1rem" }}>No prayer requests on file.</p>
      )}
    </div>
  );
}
