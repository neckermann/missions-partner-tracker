import React, { useState } from "react";
import { createPrayerRequest, updatePrayerRequest, deletePrayerRequest } from "../../api/client.js";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the other admin pages' formatDate.
function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const emptyNewRequest = {
  category: "long_term",
  requestText: "",
  dateReceived: todayInputValue(),
  isPublic: false,
  untracked: false,
  notes: "",
};

// Reused as-is on both AdminMissionaryDetail.jsx and
// AdminOrganizationDetail.jsx, same pattern as NewsletterSection.jsx.
// Pass exactly one of missionaryId/organizationId.
//
// Deliberately no status badge/coloring for "ongoing" or "untracked"
// requests — see the PrayerRequest model comment in schema.prisma for
// why: an open request isn't a problem to flag, it's just still open.
// The only status this UI calls out at all is "answered", as a quiet
// note, not a checklist item being marked off.
export default function PrayerRequestSection({ missionaryId, organizationId, prayerRequests, onChange }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answeringId, setAnsweringId] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await createPrayerRequest({
        missionaryId: missionaryId || undefined,
        organizationId: organizationId || undefined,
        category: newRequest.category,
        requestText: newRequest.requestText.trim(),
        dateReceived: newRequest.dateReceived,
        isPublic: newRequest.category === "long_term" ? newRequest.isPublic : false,
        status: newRequest.untracked ? "untracked" : "ongoing",
        notes: newRequest.notes || null,
      });
      setNewRequest(emptyNewRequest);
      setShowAddForm(false);
      await onChange();
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
      await onChange();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record the answer");
    }
  }

  async function handleDelete(request) {
    if (!confirm("Delete this prayer request? This cannot be undone.")) return;
    await deletePrayerRequest(request.id);
    await onChange();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Prayer Requests</h3>
        <button type="button" className="btn secondary small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Prayer Request"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
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

      <div style={{ marginTop: "1rem" }}>
        {prayerRequests?.length > 0 ? (
          prayerRequests.map((p) => (
            <div key={p.id} className="repeatable-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <p style={{ margin: 0 }}>{p.requestText}</p>
                  <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                    Received {formatDate(p.dateReceived)} · {p.category === "long_term" ? "Long-term" : "Short-term"}
                    {p.category === "long_term" && p.isPublic && " · Public"}
                  </div>
                  {/* The only status ever called out here is "answered" -- an
                      "ongoing" or "untracked" request just shows nothing
                      extra, matching this feature's whole design intent. */}
                  {p.status === "answered" && (
                    <div style={{ fontSize: "0.85rem", color: "#2a5d3c", marginTop: "0.4rem" }}>
                      ✓ Answered {formatDate(p.dateAnswered)}
                      {p.answeredNote && ` — ${p.answeredNote}`}
                    </div>
                  )}
                  {p.notes && <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>{p.notes}</div>}
                </div>
                <div className="table-actions">
                  {p.status !== "answered" && (
                    <button type="button" className="btn secondary small" onClick={() => startAnswer(p)}>
                      Record Answer
                    </button>
                  )}
                  <button type="button" className="btn danger small" onClick={() => handleDelete(p)}>
                    Delete
                  </button>
                </div>
              </div>

              {answeringId === p.id && (
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
                  <button type="button" className="btn small" onClick={() => submitAnswer(p.id)}>
                    Save
                  </button>
                  <button type="button" className="btn secondary small" onClick={() => setAnsweringId(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No prayer requests on file.</p>
        )}
      </div>
    </div>
  );
}
