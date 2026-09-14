import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchDocuments,
  uploadDocument,
  updateDocument,
  deleteDocument,
  extractFromDocument,
  fetchPartners,
} from "../api/client.js";
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from "../utils/documentCategories.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import ExtractionReviewModal from "../components/admin/ExtractionReviewModal.jsx";

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

function entityFor(d) {
  const p = d.partner;
  if (!p) return { type: "—", name: "—", link: null };
  return {
    type: p.kind === "organization" ? "Organization" : "Missionary",
    name: p.displayName,
    link: `/admin/partners/${p.id}`,
  };
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

// Same set/reasoning as DocumentSection.jsx (embedded on the missionary/org
// detail pages) -- everything extractRequestsFromFile actually reads (see
// backend/src/utils/extraction.js): PDF/JPEG/PNG by contentType, .eml by
// filename (its browser-reported contentType is unreliable). Word/Excel
// don't get the Scan button rather than showing one that 400s.
const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const isScannable = (d) => SCANNABLE_TYPES.has(d.contentType) || /\.eml$/i.test(d.fileName || "");

const emptyNewDocument = {
  partnerId: "",
  category: DOCUMENT_CATEGORIES[0].value,
  customCategory: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

export default function AdminDocuments() {
  const { enabledFeatures } = useSettings();
  const [scanning, setScanning] = useState(null); // the document being reviewed, or null
  const [documents, setDocuments] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDocument, setNewDocument] = useState(emptyNewDocument);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ partnerId: "", category: "", customCategory: "", title: "", receivedDate: "", notes: "" });

  function reload() {
    fetchDocuments().then(setDocuments).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newDocument.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    if (newDocument.category === "other" && !newDocument.customCategory.trim()) {
      setError("Enter a label for this document's category");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partnerId", newDocument.partnerId);
      formData.append("category", newDocument.category);
      if (newDocument.category === "other") formData.append("customCategory", newDocument.customCategory);
      formData.append("title", newDocument.title);
      formData.append("receivedDate", newDocument.receivedDate);
      formData.append("notes", newDocument.notes);

      await uploadDocument(formData);
      setNewDocument(emptyNewDocument);
      setFile(null);
      setShowAddForm(false);
      reload();
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
    const entity = entityFor(d);
    if (!confirm(`Delete this document for ${entity.name}? This cannot be undone.`)) return;
    await deleteDocument(d.id);
    reload();
  }

  // Everything but the file itself is editable (see the PUT route comment
  // in backend/src/routes/documents.js), including moving it to a
  // different partner.
  function startEdit(d) {
    setError("");
    setEditingId(d.id);
    setEditForm({
      partnerId: d.partner?.id || "",
      category: d.category,
      customCategory: d.customCategory || "",
      title: d.title || "",
      receivedDate: String(d.receivedDate).slice(0, 10),
      notes: d.notes || "",
    });
  }

  async function submitEdit(id) {
    setError("");
    if (!editForm.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (editForm.category === "other" && !editForm.customCategory.trim()) {
      setError("Enter a label for this document's category");
      return;
    }
    try {
      await updateDocument(id, {
        partnerId: editForm.partnerId,
        category: editForm.category,
        customCategory: editForm.category === "other" ? editForm.customCategory : null,
        title: editForm.title,
        receivedDate: editForm.receivedDate,
        notes: editForm.notes,
      });
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save changes");
    }
  }

  const filtered = documents.filter(
    (d) =>
      (entityFilter === "all" || entityFor(d).type === entityFilter) &&
      (categoryFilter === "all" || d.category === categoryFilter)
  );

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Documents</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Upload Document"}
        </button>
      </div>
      <p style={{ color: "#555" }}>
        Survey responses, signed policies, other office documents, and long-term email records from
        missionary and organization partners. Admin-only — never shown on the public site.
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Partner
              <PartnerSelect
                partners={partners}
                value={newDocument.partnerId}
                onChange={(partnerId) => setNewDocument((f) => ({ ...f, partnerId }))}
                required
              />
            </label>
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
              <select
                value={newDocument.category}
                onChange={(e) => setNewDocument((f) => ({ ...f, category: e.target.value }))}
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {newDocument.category === "other" && (
              <label>
                Category label
                <input
                  value={newDocument.customCategory}
                  onChange={(e) => setNewDocument((f) => ({ ...f, customCategory: e.target.value }))}
                  placeholder="e.g. Background Check"
                  required
                />
              </label>
            )}
            <label>
              Title (optional)
              <input
                value={newDocument.title}
                onChange={(e) => setNewDocument((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. 2026 Field Survey"
              />
            </label>
            <label>
              Received Date
              <input
                type="date"
                value={newDocument.receivedDate}
                onChange={(e) => setNewDocument((f) => ({ ...f, receivedDate: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={newDocument.notes}
                onChange={(e) => setNewDocument((f) => ({ ...f, notes: e.target.value }))}
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

      <div className="admin-checkbox-row" style={{ marginTop: "1rem", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ flexDirection: "row", fontWeight: "normal" }}>Show:</label>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All</option>
            <option value="Missionary">Missionaries</option>
            <option value="Organization">Organizations</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ flexDirection: "row", fontWeight: "normal" }}>Category:</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Partner</th>
            <th>Type</th>
            <th>Category</th>
            <th>Title</th>
            <th>Received</th>
            <th>File</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((d) => {
            const entity = entityFor(d);
            return (
              <React.Fragment key={d.id}>
                <tr>
                  <td>{entity.link ? <Link to={entity.link}>{entity.name}</Link> : entity.name}</td>
                  <td>{entity.type}</td>
                  <td>{documentCategoryLabel(d)}</td>
                  <td>{d.title || "—"}</td>
                  <td>{editingId === d.id ? formatDate(editForm.receivedDate) : formatDate(d.receivedDate)}</td>
                  <td>
                    {d.fileName}
                    {d.fileSize != null && (
                      <span style={{ color: "#888", fontSize: "0.85rem" }}> ({formatFileSize(d.fileSize)})</span>
                    )}
                  </td>
                  <td style={{ maxWidth: "16rem" }}>{editingId === d.id ? editForm.notes || "—" : d.notes || "—"}</td>
                  <td className="table-actions">
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
                  </td>
                </tr>
                {editingId === d.id && (
                  <tr>
                    <td colSpan={8}>
                      <div className="form-grid">
                        <label style={{ gridColumn: "1 / -1" }} title="Everything but the file itself can be edited.">
                          Partner
                          <PartnerSelect
                            partners={partners}
                            value={editForm.partnerId}
                            onChange={(partnerId) => setEditForm((f) => ({ ...f, partnerId }))}
                            required
                          />
                        </label>
                        <label>
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
                      </div>
                      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
                      <div style={{ marginTop: "0.5rem" }}>
                        <button type="button" className="btn small" onClick={() => submitEdit(d.id)}>
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "#888" }}>
                No documents on file.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromDocument(scanning.id)}
          partnerId={scanning.partner?.id}
          defaultDate={scanning.receivedDate}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
