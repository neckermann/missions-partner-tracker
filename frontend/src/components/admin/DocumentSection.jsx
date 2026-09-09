import React, { useState } from "react";
import { uploadDocument, updateDocument, deleteDocument, extractFromDocument } from "../../api/client.js";
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

// Everything extractRequestsFromFile actually reads (see
// backend/src/utils/extraction.js): PDF/JPEG/PNG by contentType, .eml by
// filename (its browser-reported contentType is unreliable -- same
// reasoning as resolveExt() in routes/documents.js). Word/Excel uploads
// (allowed for documents generally, see the file input below) don't get
// the Scan button rather than showing one that 400s.
const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const isScannable = (d) => SCANNABLE_TYPES.has(d.contentType) || /\.eml$/i.test(d.fileName || "");

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
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ category: "", customCategory: "", title: "", receivedDate: "", notes: "" });

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

  // Everything but the file itself is editable (see the PUT route comment
  // in backend/src/routes/documents.js). Re-parenting to a different
  // missionary/organization isn't offered here -- this section is embedded
  // on that partner's own detail page, which doesn't have the full
  // missionary/organization list loaded; use the top-level Documents page
  // for that.
  function startEdit(d) {
    setEditingId(d.id);
    setError("");
    setEditForm({
      category: d.category,
      customCategory: d.customCategory || "",
      title: d.title || "",
      receivedDate: String(d.receivedDate).slice(0, 10),
      notes: d.notes || "",
    });
  }

  async function submitEdit(id) {
    setError("");
    if (editForm.category === "other" && !editForm.customCategory.trim()) {
      setError("Enter a label for this document's category");
      return;
    }
    try {
      await updateDocument(id, {
        category: editForm.category,
        customCategory: editForm.category === "other" ? editForm.customCategory : null,
        title: editForm.title,
        receivedDate: editForm.receivedDate,
        notes: editForm.notes,
      });
      setEditingId(null);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save changes");
    }
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
                  {enabledFeatures.aiExtraction && isScannable(d) && (
                    <button type="button" className="btn secondary small" onClick={() => setScanning(d)}>
                      Scan for requests
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => (editingId === d.id ? (setEditingId(null), setError("")) : startEdit(d))}
                  >
                    {editingId === d.id ? "Cancel" : "Edit"}
                  </button>
                  <button type="button" className="btn danger small" onClick={() => handleDelete(d)}>
                    Delete
                  </button>
                </div>
              </div>
              {editingId === d.id && (
                <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <label title="Everything but the file itself can be edited. To move this to a different missionary/organization, use the top-level Documents page.">
                    Category
                    <select
                      value={editForm.category}
                      onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    >
                      {DOCUMENT_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editForm.category === "other" && (
                    <label>
                      Category label
                      <input
                        value={editForm.customCategory}
                        onChange={(e) => setEditForm((f) => ({ ...f, customCategory: e.target.value }))}
                        placeholder="e.g. Background Check"
                        required
                      />
                    </label>
                  )}
                  <label>
                    Title
                    <input
                      value={editForm.title}
                      onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. 2026 Field Survey"
                    />
                  </label>
                  <label>
                    Received Date
                    <input
                      type="date"
                      value={editForm.receivedDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, receivedDate: e.target.value }))}
                      required
                    />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    Notes
                    <input
                      value={editForm.notes}
                      onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                  {error && <p style={{ color: "#b91c1c", gridColumn: "1 / -1" }}>{error}</p>}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <button type="button" className="btn small" onClick={() => submitEdit(d.id)}>
                      Save
                    </button>
                  </div>
                </div>
              )}
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
