import React, { useEffect, useMemo, useState } from "react";
import { uploadPartnerImage, deletePartnerPhoto } from "../../api/client.js";
import { formatDate, todayInputValue } from "../../utils/format.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";
import PhotoTile from "../shared/PhotoTile.jsx";

// Uploading always adds a new photo rather than replacing the current one;
// photos is expected pre-sorted newest-received-first (see
// partnerRecordInclude in backend/src/routes/partners.js), so photos[0] is
// "current."
export default function PhotoHistorySection({
  partnerId,
  photos,
  onChange,
  canEdit = true,
  canDelete = true,
}) {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [showAddForm, setShowAddForm] = useState(false);
  const [receivedDate, setReceivedDate] = useState(todayInputValue());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Visibility only, not a crop editor -- this app has no crop-editing
  // infrastructure anywhere to extend (confirmed before building this). Shows
  // exactly what object-fit: cover will actually keep in the two real shapes
  // this photo ends up in (Partner Detail's 160px circle, Directory's 160px
  // rect card) before upload, so a badly-framed photo is caught here instead
  // of discovered later on the live page.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
    const confirmed = await confirmDialog({
      title: `Delete this photo (received ${formatDate(p.receivedDate)})?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deletePartnerPhoto(partnerId, p.id);
    await onChange();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Photo History</h3>
        {canEdit && (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => (setShowAddForm((v) => !v), setError(""), setFile(null))}
          >
            {showAddForm ? "Cancel" : "+ Add Photo"}
          </button>
        )}
      </div>

      {canEdit && showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label>
              Photo (JPEG, PNG, WebP, or HEIC/HEIF)
              <input
                type="file"
                // Extensions alongside the MIME types -- a HEIC file (the
                // default on every iPhone) doesn't reliably report a MIME
                // type the browser's own file picker can filter on, same
                // reasoning as resolveImageExt on the backend.
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                onChange={(e) => setFile(e.target.files[0] || null)}
                required
              />
            </label>
            {previewUrl && (
              <div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                  Preview — how this will actually crop on the site
                </div>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
                  <PhotoTile src={previewUrl} alt="" shape="circle" size={80} />
                  <PhotoTile src={previewUrl} alt="" shape="rect" size={80} fluidWidth={false} />
                </div>
              </div>
            )}
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
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
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
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--muted)",
                        marginTop: i === 0 ? "0.25rem" : 0,
                      }}
                    >
                      Received {formatDate(p.receivedDate)}
                    </div>
                  </div>
                </div>
                <div className="table-actions">
                  <a href={p.url} target="_blank" rel="noreferrer" className="btn secondary small">
                    View
                  </a>
                  {canDelete && (
                    <button type="button" className="btn danger small" onClick={() => handleDelete(p)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "var(--muted)" }}>No photos on file.</p>
        )}
      </div>
      {confirmElement}
    </div>
  );
}
