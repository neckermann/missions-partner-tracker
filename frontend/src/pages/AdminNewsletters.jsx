import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchNewsletters,
  uploadNewsletter,
  updateNewsletter,
  deleteNewsletter,
  extractFromNewsletter,
  fetchAdminMissionaries,
  fetchAdminOrganizations,
} from "../api/client.js";
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

function entityFor(n) {
  if (n.missionary) return { type: "Missionary", name: n.missionary.displayName, link: `/admin/missionaries/${n.missionary.id}` };
  if (n.organization) return { type: "Organization", name: n.organization.name, link: `/admin/organizations/${n.organization.id}` };
  return { type: "—", name: "—", link: null };
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

// Same set/reasoning as NewsletterSection.jsx (embedded on the missionary/org
// detail pages) -- everything extractRequestsFromFile actually reads (see
// backend/src/utils/extraction.js): PDF/JPEG/PNG by contentType, .eml by
// filename (its browser-reported contentType is unreliable).
const SCANNABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const isScannable = (n) => SCANNABLE_TYPES.has(n.contentType) || /\.eml$/i.test(n.fileName || "");

const emptyNewNewsletter = {
  entityKey: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

export default function AdminNewsletters() {
  const { enabledFeatures } = useSettings();
  const [scanning, setScanning] = useState(null); // the newsletter being reviewed, or null
  const [newsletters, setNewsletters] = useState([]);
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNewsletter, setNewNewsletter] = useState(emptyNewNewsletter);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ entityKey: "", title: "", receivedDate: "", notes: "" });

  function reload() {
    fetchNewsletters().then(setNewsletters).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newNewsletter.entityKey) {
      setError("Choose a missionary or organization");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    const [entityType, entityId] = newNewsletter.entityKey.split(":");
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (entityType === "missionary") formData.append("missionaryId", entityId);
      if (entityType === "organization") formData.append("organizationId", entityId);
      formData.append("title", newNewsletter.title);
      formData.append("receivedDate", newNewsletter.receivedDate);
      formData.append("notes", newNewsletter.notes);

      await uploadNewsletter(formData);
      setNewNewsletter(emptyNewNewsletter);
      setFile(null);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to upload newsletter");
    } finally {
      setSaving(false);
    }
  }

  function handleView(n) {
    // A direct, same-origin, cookie-authenticated download — no async
    // lookup needed now that the file is served straight from the
    // database (see backend/src/routes/newsletters.js).
    window.open(`/api/newsletters/${n.id}/download`, "_blank");
  }

  async function handleDelete(n) {
    const entity = entityFor(n);
    if (!confirm(`Delete this newsletter for ${entity.name}? This cannot be undone.`)) return;
    await deleteNewsletter(n.id);
    reload();
  }

  // Everything but the file itself is editable (see the PUT route comment
  // in backend/src/routes/newsletters.js) -- entityKey mirrors the same
  // combined missionary/organization dropdown used in the Add form above.
  function startEdit(n) {
    const entity = entityFor(n);
    const entityKey = n.missionary ? `missionary:${n.missionary.id}` : n.organization ? `organization:${n.organization.id}` : "";
    setEditingId(n.id);
    setEditForm({
      entityKey,
      title: n.title || "",
      receivedDate: String(n.receivedDate).slice(0, 10),
      notes: n.notes || "",
    });
  }

  async function submitEdit(id) {
    if (!editForm.entityKey) {
      alert("Choose a missionary or organization");
      return;
    }
    const [entityType, entityId] = editForm.entityKey.split(":");
    try {
      await updateNewsletter(id, {
        missionaryId: entityType === "missionary" ? entityId : null,
        organizationId: entityType === "organization" ? entityId : null,
        title: editForm.title,
        receivedDate: editForm.receivedDate,
        notes: editForm.notes,
      });
      setEditingId(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save changes");
    }
  }

  const filtered = newsletters.filter((n) => entityFilter === "all" || entityFor(n).type === entityFilter);

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Newsletters</h2>
          <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? "Cancel" : "+ Upload Newsletter"}
          </button>
        </div>
        <p style={{ color: "#555" }}>
          PDF, .eml, or image files from missionary and organization partners. Admin-only — never
          shown on the public site.
        </p>

        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
            <div className="form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                Missionary or Organization
                <select
                  value={newNewsletter.entityKey}
                  onChange={(e) => setNewNewsletter((f) => ({ ...f, entityKey: e.target.value }))}
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
                <input
                  value={newNewsletter.title}
                  onChange={(e) => setNewNewsletter((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Summer 2026 Update"
                />
              </label>
              <label>
                Received Date
                <input
                  type="date"
                  value={newNewsletter.receivedDate}
                  onChange={(e) => setNewNewsletter((f) => ({ ...f, receivedDate: e.target.value }))}
                  required
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Notes
                <input
                  value={newNewsletter.notes}
                  onChange={(e) => setNewNewsletter((f) => ({ ...f, notes: e.target.value }))}
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

        <div className="admin-checkbox-row" style={{ marginTop: "1rem", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ flexDirection: "row", fontWeight: "normal" }}>Show:</label>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All</option>
            <option value="Missionary">Missionaries</option>
            <option value="Organization">Organizations</option>
          </select>
        </div>

        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Type</th>
              <th>Title</th>
              <th>Received</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => {
              const entity = entityFor(n);
              return (
                <React.Fragment key={n.id}>
                  <tr>
                    <td>{entity.link ? <Link to={entity.link}>{entity.name}</Link> : entity.name}</td>
                    <td>{entity.type}</td>
                    <td>{n.title || "—"}</td>
                    <td>{formatDate(n.receivedDate)}</td>
                    <td>
                      {n.fileName}
                      {n.fileSize != null && (
                        <span style={{ color: "#888", fontSize: "0.85rem" }}> ({formatFileSize(n.fileSize)})</span>
                      )}
                    </td>
                    <td className="table-actions">
                      <button type="button" className="btn secondary small" onClick={() => handleView(n)}>
                        View
                      </button>
                      {enabledFeatures.aiExtraction && isScannable(n) && (
                        <button type="button" className="btn secondary small" onClick={() => setScanning(n)}>
                          Scan for requests
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => (editingId === n.id ? setEditingId(null) : startEdit(n))}
                      >
                        {editingId === n.id ? "Cancel" : "Edit"}
                      </button>
                      <button type="button" className="btn danger small" onClick={() => handleDelete(n)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                  {editingId === n.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="form-grid">
                          <label style={{ gridColumn: "1 / -1" }} title="Everything but the file itself can be edited.">
                            Missionary or Organization
                            <select
                              value={editForm.entityKey}
                              onChange={(e) => setEditForm((f) => ({ ...f, entityKey: e.target.value }))}
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
                        </div>
                        <div style={{ marginTop: "0.5rem" }}>
                          <button type="button" className="btn small" onClick={() => submitEdit(n.id)}>
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
                <td colSpan={6} style={{ color: "#888" }}>
                  No newsletters on file.
                </td>
              </tr>
            )}
        </tbody>
      </table>

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromNewsletter(scanning.id)}
          missionaryId={scanning.missionary?.id}
          organizationId={scanning.organization?.id}
          defaultDate={scanning.receivedDate}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
