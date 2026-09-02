import React, { useState } from "react";
import { uploadNewsletter, getNewsletterDownloadUrl, deleteNewsletter } from "../../api/client.js";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the other admin pages' formatDate.
function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

// Reused as-is (not duplicated) on both AdminMissionaryDetail.jsx and
// AdminOrganizationDetail.jsx — unlike the small presentational Field/
// AddressSummary helpers those pages already duplicate, this one carries
// real upload/view/delete behavior, so it's a genuine shared component
// rather than something worth copy-pasting twice. Pass exactly one of
// missionaryId/organizationId — matches the Newsletter model's shape.
export default function NewsletterSection({ missionaryId, organizationId, newsletters, onChange }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (missionaryId) formData.append("missionaryId", missionaryId);
      if (organizationId) formData.append("organizationId", organizationId);
      formData.append("title", title);
      formData.append("receivedDate", receivedDate);
      formData.append("notes", notes);

      await uploadNewsletter(formData);
      setTitle("");
      setReceivedDate(todayInputValue());
      setNotes("");
      setFile(null);
      setShowAddForm(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to upload newsletter");
    } finally {
      setSaving(false);
    }
  }

  async function handleView(n) {
    try {
      const url = await getNewsletterDownloadUrl(n.id);
      window.open(url, "_blank");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to open file");
    }
  }

  async function handleDelete(n) {
    if (!confirm(`Delete "${n.title || n.fileName}"? This cannot be undone.`)) return;
    await deleteNewsletter(n.id);
    await onChange();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Newsletters</h3>
        <button type="button" className="btn secondary small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Newsletter"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              File (PDF, .eml, JPG, or PNG)
              <input
                type="file"
                accept=".pdf,.eml,image/jpeg,image/png"
                onChange={(e) => setFile(e.target.files[0] || null)}
                required
              />
            </label>
            <label>
              Title (optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summer 2026 Update" />
            </label>
            <label>
              Received Date
              <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} required />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: "1rem" }}>
        {newsletters?.length > 0 ? (
          newsletters.map((n) => (
            <div key={n.id} className="repeatable-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>{n.title || n.fileName}</strong>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    Received {formatDate(n.receivedDate)} · {n.fileName}
                    {n.fileSize != null && ` (${formatFileSize(n.fileSize)})`}
                  </div>
                  {n.notes && <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>{n.notes}</div>}
                </div>
                <div className="table-actions">
                  <button type="button" className="btn secondary small" onClick={() => handleView(n)}>
                    View
                  </button>
                  <button type="button" className="btn danger small" onClick={() => handleDelete(n)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No newsletters on file.</p>
        )}
      </div>
    </div>
  );
}
