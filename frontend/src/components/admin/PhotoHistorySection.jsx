import React, { useState } from "react";
import { uploadPartnerImage, deletePartnerPhoto } from "../../api/client.js";
import { formatDate, todayInputValue } from "../../utils/format.js";

// Uploading always adds a new photo rather than replacing the current one;
// photos is expected pre-sorted newest-received-first (see
// partnerRecordInclude in backend/src/routes/partners.js), so photos[0] is
// "current."
export default function PhotoHistorySection({ partnerId, photos, onChange }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [receivedDate, setReceivedDate] = useState(todayInputValue());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Choose a photo to upload");
      return;
    }
    setSaving(true);
    try {
      await uploadPartnerImage(partnerId, file, receivedDate);
      setReceivedDate(todayInputValue());
      setFile(null);
      setShowAddForm(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to upload photo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p) {
    if (!confirm(`Delete this photo (received ${formatDate(p.receivedDate)})? This cannot be undone.`))
      return;
    await deletePartnerPhoto(partnerId, p.id);
    await onChange();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Photo History</h3>
        <button type="button" className="btn secondary small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Photo"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label>
              Photo (JPEG, PNG, or WebP)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files[0] || null)}
                required
              />
            </label>
            <label>
              Received Date
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                required
              />
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
        {photos?.length > 0 ? (
          photos.map((p, i) => (
            <div key={p.id} className="repeatable-row">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <img
                    src={p.url}
                    alt=""
                    className="missionary-thumb"
                    onError={(e) => (e.target.style.display = "none")}
                  />
                  <div>
                    {i === 0 && <span className="status-pill good">Current</span>}
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: i === 0 ? "0.25rem" : 0 }}>
                      Received {formatDate(p.receivedDate)}
                    </div>
                  </div>
                </div>
                <div className="table-actions">
                  <a href={p.url} target="_blank" rel="noreferrer" className="btn secondary small">
                    View
                  </a>
                  <button type="button" className="btn danger small" onClick={() => handleDelete(p)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No photos on file.</p>
        )}
      </div>
    </div>
  );
}
