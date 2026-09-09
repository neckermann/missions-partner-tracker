import React, { useState } from "react";
import { uploadDocument, deleteDocument, extractFromDocument } from "../../api/client.js";
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from "../../utils/documentCategories.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import ExtractionReviewModal from "./ExtractionReviewModal.jsx";

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

// Claude's document input only natively reads PDF/JPEG/PNG (see
// backend/src/utils/extraction.js) -- Word/Excel/.eml uploads (allowed for
// documents generally, see the file input below) just don't get the Scan
// button rather than showing one that always 400s.
const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

// Same shared-vs-duplicated reasoning as NewsletterSection: reused as-is on
// both AdminMissionaryDetail.jsx and AdminOrganizationDetail.jsx. Pass
// exactly one of missionaryId/organizationId — matches the Document
// model's shape.
export default function DocumentSection({ missionaryId, organizationId, documents, onChange }) {
  const { enabledFeatures } = useSettings();
  const [scanning, setScanning] = useState(null); // the document being reviewed, or null
  const [showAddForm, setShowAddForm] = useState(false);
  const [category, setCategory] = useState(DOCUMENT_CATEGORIES[0].value);
  const [customCategory, setCustomCategory] = useState("");
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
    if (category === "other" && !customCategory.trim()) {
      setError("Enter a label for this document's category");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (missionaryId) formData.append("missionaryId", missionaryId);
      if (organizationId) formData.append("organizationId", organizationId);
      formData.append("category", category);
      if (category === "other") formData.append("customCategory", customCategory);
      formData.append("title", title);
      formData.append("receivedDate", receivedDate);
      formData.append("notes", notes);

      await uploadDocument(formData);
      setCategory(DOCUMENT_CATEGORIES[0].value);
      setCustomCategory("");
      setTitle("");
      setReceivedDate(todayInputValue());
      setNotes("");
      setFile(null);
      setShowAddForm(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to upload document");
    } finally {
      setSaving(false);
    }
  }

  function handleView(d) {
    // A direct, same-origin, cookie-authenticated download — no async
    // lookup needed now that the file is served straight from the
    // database (see backend/src/routes/documents.js).
    window.open(`/api/documents/${d.id}/download`, "_blank");
  }

  async function handleDelete(d) {
    if (!confirm(`Delete "${d.title || d.fileName}"? This cannot be undone.`)) return;
    await deleteDocument(d.id);
    await onChange();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Documents</h3>
        <button type="button" className="btn secondary small" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Document"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              File (PDF, Word, Excel, .eml, JPG, or PNG)
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.eml,image/jpeg,image/png"
                onChange={(e) => setFile(e.target.files[0] || null)}
                required
              />
            </label>
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {category === "other" && (
              <label>
                Category label
                <input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="e.g. Background Check"
                  required
                />
              </label>
            )}
            <label>
              Title (optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 2026 Field Survey" />
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
        {documents?.length > 0 ? (
          documents.map((d) => (
            <div key={d.id} className="repeatable-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>{d.title || d.fileName}</strong>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {documentCategoryLabel(d)} · Received {formatDate(d.receivedDate)} · {d.fileName}
                    {d.fileSize != null && ` (${formatFileSize(d.fileSize)})`}
                  </div>
                  {d.notes && <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>{d.notes}</div>}
                </div>
                <div className="table-actions">
                  <button type="button" className="btn secondary small" onClick={() => handleView(d)}>
                    View
                  </button>
                  {enabledFeatures.aiExtraction && SCANNABLE_TYPES.has(d.contentType) && (
                    <button type="button" className="btn secondary small" onClick={() => setScanning(d)}>
                      Scan for requests
                    </button>
                  )}
                  <button type="button" className="btn danger small" onClick={() => handleDelete(d)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No documents on file.</p>
        )}
      </div>

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromDocument(scanning.id)}
          missionaryId={missionaryId}
          organizationId={organizationId}
          defaultDate={scanning.receivedDate}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
