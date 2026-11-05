import React, { useState } from "react";
import { uploadPartnerFile, updatePartnerFile, deletePartnerFile, extractFromPartnerFile } from "../../api/client.js";
import { FILE_KINDS, fileKindLabel } from "../../utils/fileKinds.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import ExtractionReviewModal from "./ExtractionReviewModal.jsx";
import { formatDate, todayInputValue, toDateInputValue, formatFileSize } from "../../utils/format.js";
import { isScannable } from "../../utils/scannable.js";
import useLoadMore from "../../hooks/useLoadMore.js";
import LoadMoreButton from "../LoadMoreButton.jsx";

// Reused as-is (not duplicated) on both AdminMissionaryDetail.jsx and
// AdminOrganizationDetail.jsx — unlike the small presentational Field/
// AddressSummary helpers those pages already duplicate, this one carries
// real upload/view/delete behavior, so it's a genuine shared component
// rather than something worth copy-pasting twice.
export default function PartnerFileSection({ partnerId, files, onChange }) {
  const { enabledFeatures } = useSettings();
  const [scanning, setScanning] = useState(null); // the file being reviewed, or null
  const [showAddForm, setShowAddForm] = useState(false);
  const [kind, setKind] = useState(FILE_KINDS[0].value);
  const [customKind, setCustomKind] = useState("");
  const [title, setTitle] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ kind: "", customKind: "", title: "", receivedDate: "", notes: "" });
  const { visible, hasMore, remaining, showMore } = useLoadMore(files);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    if (kind === "other" && !customKind.trim()) {
      setError("Enter a label for this file's kind");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partnerId", partnerId);
      formData.append("kind", kind);
      if (kind === "other") formData.append("customKind", customKind);
      formData.append("title", title);
      formData.append("receivedDate", receivedDate);
      formData.append("notes", notes);

      await uploadPartnerFile(formData);
      setKind(FILE_KINDS[0].value);
      setCustomKind("");
      setTitle("");
      setReceivedDate(todayInputValue());
      setNotes("");
      setFile(null);
      setShowAddForm(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to upload file");
    } finally {
      setSaving(false);
    }
  }

  function handleView(f) {
    // A direct, same-origin, cookie-authenticated download — no async
    // lookup needed, the file is served straight from the database (see
    // backend/src/routes/partnerFiles.js).
    window.open(`/api/partner-files/${f.id}/download`, "_blank");
  }

  async function handleDelete(f) {
    if (!confirm(`Delete "${f.title || f.fileName}"? This cannot be undone.`)) return;
    await deletePartnerFile(f.id);
    await onChange();
  }

  // Everything but the file itself is editable (see the PUT route comment
  // in backend/src/routes/partnerFiles.js), including `kind`. Re-parenting
  // to a different missionary/organization isn't offered here -- this
  // section is embedded on that partner's own detail page, which doesn't
  // have the full missionary/organization list loaded; use the top-level
  // Newsletters & Docs page for that.
  function startEdit(f) {
    setEditingId(f.id);
    setError("");
    setEditForm({
      kind: f.kind,
      customKind: f.customKind || "",
      title: f.title || "",
      receivedDate: toDateInputValue(f.receivedDate),
      notes: f.notes || "",
    });
  }

  async function submitEdit(id) {
    setError("");
    if (editForm.kind === "other" && !editForm.customKind.trim()) {
      setError("Enter a label for this file's kind");
      return;
    }
    try {
      await updatePartnerFile(id, {
        kind: editForm.kind,
        customKind: editForm.kind === "other" ? editForm.customKind : null,
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
        <h3 style={{ flex: 1, marginBottom: 0 }}>Newsletters &amp; Docs</h3>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => (setShowAddForm((v) => !v), setError(""))}
        >
          {showAddForm ? "Cancel" : "+ Add File"}
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
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {FILE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {kind === "other" && (
              <label>
                Kind label
                <input
                  value={customKind}
                  onChange={(e) => setCustomKind(e.target.value)}
                  placeholder="e.g. Background Check"
                  required
                />
              </label>
            )}
            <label>
              Title (optional)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer 2026 Update"
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
        {files?.length > 0 ? (
          visible.map((f) => (
            <div key={f.id} className="repeatable-row">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <strong>{f.title || f.fileName}</strong>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {fileKindLabel(f)} · Received {formatDate(f.receivedDate)} · {f.fileName}
                    {f.fileSize != null && ` (${formatFileSize(f.fileSize)})`}
                  </div>
                  {f.notes && (
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>{f.notes}</div>
                  )}
                </div>
                <div className="table-actions">
                  <button type="button" className="btn secondary small" onClick={() => handleView(f)}>
                    View
                  </button>
                  {enabledFeatures.aiExtraction && isScannable(f) && (
                    <button type="button" className="btn secondary small" onClick={() => setScanning(f)}>
                      Scan for requests
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => (editingId === f.id ? (setEditingId(null), setError("")) : startEdit(f))}
                  >
                    {editingId === f.id ? "Cancel" : "Edit"}
                  </button>
                  <button type="button" className="btn danger small" onClick={() => handleDelete(f)}>
                    Delete
                  </button>
                </div>
              </div>
              {editingId === f.id && (
                <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <label title="Everything but the file itself can be edited. To move this to a different missionary/organization, use the top-level Newsletters & Docs page.">
                    Kind
                    <select
                      value={editForm.kind}
                      onChange={(e) => setEditForm((f) => ({ ...f, kind: e.target.value }))}
                    >
                      {FILE_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editForm.kind === "other" && (
                    <label>
                      Kind label
                      <input
                        value={editForm.customKind}
                        onChange={(e) => setEditForm((f) => ({ ...f, customKind: e.target.value }))}
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
                      placeholder="e.g. Summer 2026 Update"
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
                    <button type="button" className="btn small" onClick={() => submitEdit(f.id)}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No files on record.</p>
        )}
        <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} size="small" />
      </div>

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromPartnerFile(scanning.id)}
          partnerId={partnerId}
          defaultDate={scanning.receivedDate}
          sourceFileId={scanning.id}
          onChange={onChange}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
