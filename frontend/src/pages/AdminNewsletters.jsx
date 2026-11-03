import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchNewsletters,
  uploadNewsletter,
  updateNewsletter,
  deleteNewsletter,
  extractFromNewsletter,
  fetchPartners,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import ExtractionReviewModal from "../components/admin/ExtractionReviewModal.jsx";
import { formatDate, todayInputValue, formatFileSize } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, inDateRange } from "../utils/dateRange.js";
import { entityFor } from "../utils/partnerEntity.js";
import { isScannable } from "../utils/scannable.js";
import useLoadMore from "../hooks/useLoadMore.js";

const emptyNewNewsletter = {
  partnerId: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

export default function AdminNewsletters() {
  const { enabledFeatures } = useSettings();
  const [scanning, setScanning] = useState(null); // the newsletter being reviewed, or null
  const [newsletters, setNewsletters] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNewsletter, setNewNewsletter] = useState(emptyNewNewsletter);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ partnerId: "", title: "", receivedDate: "", notes: "" });

  function reload() {
    fetchNewsletters().then(setNewsletters).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newNewsletter.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partnerId", newNewsletter.partnerId);
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
  // in backend/src/routes/newsletters.js), including moving it to a
  // different partner.
  function startEdit(n) {
    setEditingId(n.id);
    setEditForm({
      partnerId: n.partner?.id || "",
      title: n.title || "",
      receivedDate: String(n.receivedDate).slice(0, 10),
      notes: n.notes || "",
    });
  }

  async function submitEdit(id) {
    if (!editForm.partnerId) {
      alert("Choose a partner");
      return;
    }
    try {
      await updateNewsletter(id, {
        partnerId: editForm.partnerId,
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

  const filtered = newsletters.filter(
    (n) =>
      (entityFilter === "all" || entityFor(n).type === entityFilter) &&
      inDateRange(n.receivedDate, dateRangeFilter)
  );
  const {
    visible: visibleNewsletters,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(filtered, {
    initialCount: 25,
    step: 25,
  });

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Newsletters</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Upload Newsletter"}
        </button>
      </div>
      <p style={{ color: "#555" }}>
        PDF, .eml, or image files from missionary and organization partners. Admin-only — never shown on the
        public site.
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Partner
              <PartnerSelect
                partners={partners}
                value={newNewsletter.partnerId}
                onChange={(partnerId) => setNewNewsletter((f) => ({ ...f, partnerId }))}
                required
              />
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
        <label htmlFor="newsletters-entity-filter" style={{ flexDirection: "row", fontWeight: "normal" }}>
          Show:
        </label>
        <select
          id="newsletters-entity-filter"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          <option value="all">All</option>
          <option value="Missionary">Missionaries</option>
          <option value="Organization">Organizations</option>
        </select>
        <label htmlFor="newsletters-date-range-filter" style={{ flexDirection: "row", fontWeight: "normal" }}>
          Received:
        </label>
        <select
          id="newsletters-date-range-filter"
          value={dateRangeFilter}
          onChange={(e) => setDateRangeFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          {DATE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
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
          {visibleNewsletters.map((n) => {
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
                      <span style={{ color: "#888", fontSize: "0.85rem" }}>
                        {" "}
                        ({formatFileSize(n.fileSize)})
                      </span>
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
                        <label
                          style={{ gridColumn: "1 / -1" }}
                          title="Everything but the file itself can be edited."
                        >
                          Partner
                          <PartnerSelect
                            partners={partners}
                            value={editForm.partnerId}
                            onChange={(partnerId) => setEditForm((f) => ({ ...f, partnerId }))}
                            required
                          />
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
      {hasMore && (
        <button type="button" className="btn secondary" style={{ marginTop: "1rem" }} onClick={showMore}>
          Load More ({remaining} remaining)
        </button>
      )}

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromNewsletter(scanning.id)}
          partnerId={scanning.partner?.id}
          defaultDate={scanning.receivedDate}
          sourceNewsletterId={scanning.id}
          onChange={reload}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}
