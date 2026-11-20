import React, { useEffect, useMemo, useState } from "react";
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
import { todayInputValue, formatFileSize } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, resolveQuickRangeDates } from "../utils/dateRange.js";
import {
  entityFor,
  PARTNER_TYPE_FILTER_FIELD,
  INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD,
} from "../utils/partnerEntity.js";
import { isScannable } from "../utils/scannable.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";

const emptyNewFile = {
  partnerId: "",
  kind: FILE_KINDS[0].value,
  customKind: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

const emptyFilters = {
  entityType: "all",
  kind: "all",
  dateRange: "all",
  includeArchived: false,
};

// Phase 2 of the UX-rebuild plan: entityType/kind/date-range are now real
// backend query params (GET /api/partner-files -- kind already existed,
// entityType and from/to are new), same reuse argument the plan made for
// Prayer Requests/One-Time Needs: the exact filter logic already existed
// for this dataset's Report version. includeArchived stays client-side --
// this route has no archived passthrough and adding one wasn't asked for.
export default function AdminPartnerFiles() {
  const { enabledFeatures } = useSettings();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [scanning, setScanning] = useState(null); // the file being reviewed, or null
  const [files, setFiles] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFile, setNewFile] = useState(emptyNewFile);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    partnerId: "",
    kind: "",
    customKind: "",
    title: "",
    receivedDate: "",
    notes: "",
  });

  const fields = useMemo(
    () => [
      PARTNER_TYPE_FILTER_FIELD,
      {
        name: "kind",
        label: "Kind",
        type: "select",
        options: [
          { value: "all", label: "All" },
          ...FILE_KINDS.map((k) => ({ value: k.value, label: k.label })),
        ],
      },
      {
        name: "dateRange",
        label: "Received",
        type: "select",
        options: DATE_RANGE_OPTIONS,
      },
      INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD,
    ],
    []
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);
  const { partnerId: filterPartnerId, partnerName: filterPartnerName, clearPartnerFilter } =
    usePartnerUrlFilter();

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.entityType !== "all") params.entityType = filters.entityType;
    if (filters.kind !== "all") params.kind = filters.kind;
    const { from, to } = resolveQuickRangeDates(filters.dateRange);
    if (from) params.from = from;
    if (to) params.to = to;
    if (filterPartnerId) params.partnerId = filterPartnerId;
    fetchPartnerFiles(params)
      .then(setFiles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.entityType, filters.kind, filters.dateRange, filterPartnerId]);

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

  const filtered = useMemo(
    () => files.filter((f) => filters.includeArchived || !f.partner?.archived),
    [files, filters.includeArchived]
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

  const rows = useMemo(
    () =>
      visibleFiles.map((f) => {
        const entity = entityFor(f);
        return { ...f, entityType: entity.type, entityLink: entity.link, entityName: entity.name };
      }),
    [visibleFiles]
  );

  return (
    <div className="admin-shell">
      {filterPartnerId && (
        <Breadcrumb
          items={[
            { label: "Partners", to: "/admin/partners" },
            { label: filterPartnerName || "…", to: `/admin/partners/${filterPartnerId}` },
            { label: "Newsletters & Docs" },
          ]}
        />
      )}
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

      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        extraChips={
          <PartnerFilterChip
            partnerId={filterPartnerId}
            partnerName={filterPartnerName}
            onClear={clearPartnerFilter}
          />
        }
      />

      <Table
        style={{ marginTop: "1rem" }}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage={loading ? "Loading…" : "No files on record."}
        expandedRowId={editingId}
        renderExpanded={(f) => (
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }} title="Everything but the file itself can be edited.">
              Partner
              <PartnerSelect
                partners={partners}
                value={editForm.partnerId}
                onChange={(partnerId) => setEditForm((ef) => ({ ...ef, partnerId }))}
                required
              />
            </label>
            <label>
              Kind
              <select
                value={editForm.kind}
                onChange={(e) => setEditForm((ef) => ({ ...ef, kind: e.target.value }))}
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
                  onChange={(e) => setEditForm((ef) => ({ ...ef, customKind: e.target.value }))}
                  placeholder="e.g. Background Check"
                  required
                />
              </label>
            )}
            <label>
              Title
              <input
                value={editForm.title}
                onChange={(e) => setEditForm((ef) => ({ ...ef, title: e.target.value }))}
                placeholder="e.g. Summer 2026 Update"
              />
            </label>
            <label>
              Received Date
              <input
                type="date"
                value={editForm.receivedDate}
                onChange={(e) => setEditForm((ef) => ({ ...ef, receivedDate: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={editForm.notes}
                onChange={(e) => setEditForm((ef) => ({ ...ef, notes: e.target.value }))}
              />
            </label>
            {error && <p style={{ gridColumn: "1 / -1", color: "#b91c1c" }}>{error}</p>}
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="btn small" onClick={() => submitEdit(f.id)}>
                Save
              </button>
            </div>
          </div>
        )}
        columns={[
          {
            key: "entityName",
            label: "Partner",
            render: (f) => (f.entityLink ? <Link to={f.entityLink}>{f.entityName}</Link> : f.entityName),
          },
          { key: "entityType", label: "Type" },
          { key: "kind", label: "Kind", render: (f) => fileKindLabel(f) },
          { key: "title", label: "Title" },
          { key: "receivedDate", label: "Received", type: "date" },
          {
            key: "fileName",
            label: "File",
            render: (f) => (
              <>
                {f.fileName}
                {f.fileSize != null && (
                  <span style={{ color: "#888", fontSize: "0.85rem" }}> ({formatFileSize(f.fileSize)})</span>
                )}
              </>
            ),
          },
          { key: "notes", label: "Notes" },
        ]}
        renderActions={(f) => (
          <>
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
          </>
        )}
      />
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
