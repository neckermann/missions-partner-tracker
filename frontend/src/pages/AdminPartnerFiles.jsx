import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPartnerFiles,
  uploadPartnerFile,
  updatePartnerFile,
  deletePartnerFile,
  extractFromPartnerFile,
  fetchPartners,
} from "../api/client.js";
import { FILE_KINDS, fileKindLabel } from "../utils/fileKinds.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import ExtractionReviewModal from "../components/admin/ExtractionReviewModal.jsx";
import { formatDate, todayInputValue, formatFileSize } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, inDateRange } from "../utils/dateRange.js";
import { entityFor } from "../utils/partnerEntity.js";
import { isScannable } from "../utils/scannable.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

const emptyNewFile = {
  partnerId: "",
  kind: FILE_KINDS[0].value,
  customKind: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

export default function AdminPartnerFiles() {
  const { enabledFeatures } = useSettings();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [scanning, setScanning] = useState(null); // the file being reviewed, or null
  const [files, setFiles] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFile, setNewFile] = useState(emptyNewFile);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    partnerId: "",
    kind: "",
    customKind: "",
    title: "",
    receivedDate: "",
    notes: "",
  });

  function reload() {
    fetchPartnerFiles().then(setFiles).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newFile.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    if (newFile.kind === "other" && !newFile.customKind.trim()) {
      setError("Enter a label for this file's kind");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partnerId", newFile.partnerId);
      formData.append("kind", newFile.kind);
      if (newFile.kind === "other") formData.append("customKind", newFile.customKind);
      formData.append("title", newFile.title);
      formData.append("receivedDate", newFile.receivedDate);
      formData.append("notes", newFile.notes);

      await uploadPartnerFile(formData);
      setNewFile(emptyNewFile);
      setFile(null);
      setShowAddForm(false);
      reload();
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
    const entity = entityFor(f);
    const confirmed = await confirmDialog({
      title: `Delete this file for ${entity.name}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deletePartnerFile(f.id);
    reload();
  }

  // Everything but the file itself is editable (see the PUT route comment
  // in backend/src/routes/partnerFiles.js), including `kind` and moving it
  // to a different partner.
  function startEdit(f) {
    setError("");
    setEditingId(f.id);
    setEditForm({
      partnerId: f.partner?.id || "",
      kind: f.kind,
      customKind: f.customKind || "",
      title: f.title || "",
      receivedDate: String(f.receivedDate).slice(0, 10),
      notes: f.notes || "",
    });
  }

  async function submitEdit(id) {
    setError("");
    if (!editForm.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (editForm.kind === "other" && !editForm.customKind.trim()) {
      setError("Enter a label for this file's kind");
      return;
    }
    try {
      await updatePartnerFile(id, {
        partnerId: editForm.partnerId,
        kind: editForm.kind,
        customKind: editForm.kind === "other" ? editForm.customKind : null,
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

  const filtered = files.filter(
    (f) =>
      (entityFilter === "all" || entityFor(f).type === entityFilter) &&
      (kindFilter === "all" || f.kind === kindFilter) &&
      inDateRange(f.receivedDate, dateRangeFilter)
  );
  const {
    visible: visibleFiles,
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
        <h2>Newsletters &amp; Docs</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Upload File"}
        </button>
      </div>
      <p style={{ color: "#555" }}>
        Newsletters, survey responses, signed policies, other office documents, and long-term email records
        from missionary and organization partners. Admin-only — never shown on the public site.
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Partner
              <PartnerSelect
                partners={partners}
                value={newFile.partnerId}
                onChange={(partnerId) => setNewFile((f) => ({ ...f, partnerId }))}
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
              Kind
              <select
                value={newFile.kind}
                onChange={(e) => setNewFile((f) => ({ ...f, kind: e.target.value }))}
              >
                {FILE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {newFile.kind === "other" && (
              <label>
                Kind label
                <input
                  value={newFile.customKind}
                  onChange={(e) => setNewFile((f) => ({ ...f, customKind: e.target.value }))}
                  placeholder="e.g. Background Check"
                  required
                />
              </label>
            )}
            <label>
              Title (optional)
              <input
                value={newFile.title}
                onChange={(e) => setNewFile((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Summer 2026 Update"
              />
            </label>
            <label>
              Received Date
              <input
                type="date"
                value={newFile.receivedDate}
                onChange={(e) => setNewFile((f) => ({ ...f, receivedDate: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={newFile.notes}
                onChange={(e) => setNewFile((f) => ({ ...f, notes: e.target.value }))}
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

      <div
        className="admin-checkbox-row"
        style={{ marginTop: "1rem", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="partner-files-entity-filter" style={{ flexDirection: "row", fontWeight: "normal" }}>
            Show:
          </label>
          <select
            id="partner-files-entity-filter"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="all">All</option>
            <option value="Missionary">Missionaries</option>
            <option value="Organization">Organizations</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="partner-files-kind-filter" style={{ flexDirection: "row", fontWeight: "normal" }}>
            Kind:
          </label>
          <select
            id="partner-files-kind-filter"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="all">All</option>
            {FILE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label
            htmlFor="partner-files-date-range-filter"
            style={{ flexDirection: "row", fontWeight: "normal" }}
          >
            Received:
          </label>
          <select
            id="partner-files-date-range-filter"
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
      </div>

      <div className="table-scroll">
      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Partner</th>
            <th>Type</th>
            <th>Kind</th>
            <th>Title</th>
            <th>Received</th>
            <th>File</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleFiles.map((f) => {
            const entity = entityFor(f);
            return (
              <React.Fragment key={f.id}>
                <tr>
                  <td>{entity.link ? <Link to={entity.link}>{entity.name}</Link> : entity.name}</td>
                  <td>{entity.type}</td>
                  <td>{fileKindLabel(f)}</td>
                  <td>{f.title || "—"}</td>
                  <td>
                    {editingId === f.id ? formatDate(editForm.receivedDate) : formatDate(f.receivedDate)}
                  </td>
                  <td>
                    {f.fileName}
                    {f.fileSize != null && (
                      <span style={{ color: "#888", fontSize: "0.85rem" }}>
                        {" "}
                        ({formatFileSize(f.fileSize)})
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: "16rem" }}>
                    {editingId === f.id ? editForm.notes || "—" : f.notes || "—"}
                  </td>
                  <td className="table-actions">
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
                  </td>
                </tr>
                {editingId === f.id && (
                  <tr>
                    <td colSpan={8}>
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
                      </div>
                      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
                      <div style={{ marginTop: "0.5rem" }}>
                        <button type="button" className="btn small" onClick={() => submitEdit(f.id)}>
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
                No files on record.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />

      {scanning && (
        <ExtractionReviewModal
          scan={() => extractFromPartnerFile(scanning.id)}
          partnerId={scanning.partner?.id}
          defaultDate={scanning.receivedDate}
          sourceFileId={scanning.id}
          onChange={reload}
          onClose={() => setScanning(null)}
        />
      )}
      {confirmElement}
    </div>
  );
}
