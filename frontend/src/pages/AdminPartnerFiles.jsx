import React, { useEffect, useMemo, useState } from "react";
import PartnerLinkButton from "../components/admin/PartnerLinkButton.jsx";
import PageHeader from "../components/shared/PageHeader.jsx";
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
import PartnerFileFormFields from "../components/admin/PartnerFileFormFields.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import ExtractionReviewModal from "../components/admin/ExtractionReviewModal.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import Field from "../components/admin/Field.jsx";
import { todayInputValue, formatDateLong } from "../utils/format.js";
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
import useSendingChurchField from "../hooks/useSendingChurchField.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

const emptyNewFile = {
  partnerId: "",
  kind: FILE_KINDS[0].value,
  customKind: "",
  title: "",
  receivedDate: todayInputValue(),
  notes: "",
};

const emptyFilters = {
  sendingChurch: "all",
  entityType: "all",
  kind: "all",
  dateRange: "all",
  includeArchived: false,
};

// kind, entityType and date-range are backend query params (GET /api/partner-files);
// includeArchived stays client-side because the route has no archived passthrough.
export default function AdminPartnerFiles() {
  const { enabledFeatures } = useSettings();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [scanning, setScanning] = useState(null); // the file being reviewed, or null
  const [files, setFiles] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const { canWrite, isAdmin } = useCurrentUser();
  const canEdit = canWrite;
  const [activeModal, setActiveModal] = useState(null); // "add-file" | "view-file" | null
  const [newFile, setNewFile] = useState(emptyNewFile);
  const [file, setFile] = useState(null);
  const [fileDetail, setFileDetail] = useState(null); // { id, form }

  function closeModal() {
    setActiveModal(null);
    setFileDetail(null);
  }

  function openFileDetail(f) {
    setFileDetail({
      id: f.id,
      form: {
        partnerId: f.partner?.id || "",
        kind: f.kind,
        customKind: f.customKind || "",
        title: f.title || "",
        receivedDate: String(f.receivedDate).slice(0, 10),
        notes: f.notes || "",
      },
    });
    setActiveModal("view-file");
  }

  function setFileDetailForm(updater) {
    setFileDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitFileDetail() {
    if (fileDetail.form.kind === "other" && !fileDetail.form.customKind.trim()) {
      throw new Error("Enter a label for this file's kind");
    }
    if (!fileDetail.form.partnerId) {
      throw new Error("Choose a partner");
    }
    await updatePartnerFile(fileDetail.id, {
      partnerId: fileDetail.form.partnerId,
      kind: fileDetail.form.kind,
      customKind: fileDetail.form.kind === "other" ? fileDetail.form.customKind.trim() : null,
      title: fileDetail.form.title,
      receivedDate: fileDetail.form.receivedDate,
      notes: fileDetail.form.notes,
    });
    await reload();
  }

  const sendingChurchField = useSendingChurchField();
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
      ...(sendingChurchField ? [sendingChurchField] : []),
      INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD,
    ],
    [sendingChurchField]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);
  const {
    partnerId: filterPartnerId,
    partnerName: filterPartnerName,
    clearPartnerFilter,
    setPartnerFilter,
  } = usePartnerUrlFilter();

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.entityType !== "all") params.entityType = filters.entityType;
    if (filters.sendingChurch !== "all") params.sendingChurch = filters.sendingChurch;
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
  }, [filters.entityType, filters.sendingChurch, filters.kind, filters.dateRange, filterPartnerId]);

  async function submitAddFile() {
    if (!newFile.partnerId) {
      throw new Error("Choose a partner");
    }
    if (!file) {
      throw new Error("Choose a file to upload");
    }
    if (newFile.kind === "other" && !newFile.customKind.trim()) {
      throw new Error("Enter a label for this file's kind");
    }
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
    await reload();
  }

  function handleDownload(f) {
    // Same-origin download; the file is served straight from the database (routes/partnerFiles.js).
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

  // A restricted partner's letter would leave this app for an outside AI service, so the server asks for a
  // confirmation first (409). Say it plainly, and only send once the admin agrees.
  async function scanWithConfirmation(file) {
    try {
      return await extractFromPartnerFile(file.id);
    } catch (err) {
      if (err.response?.status !== 409 || !err.response?.data?.needsConfirmation) throw err;
      const ok = await confirmDialog({
        title: "Send this letter to an outside service?",
        body: (
          <ConfirmMessageBody>
            {file.partner?.displayName || "This partner"} is restricted. Scanning sends the whole letter to an
            outside AI service (Anthropic), which is outside this app and its privacy settings. Only continue
            if you are sure that is acceptable.
          </ConfirmMessageBody>
        ),
        confirmLabel: "Send for scanning",
      });
      if (!ok) {
        setScanning(null);
        return new Promise(() => {}); // the modal is already closed; nothing more to show
      }
      return extractFromPartnerFile(file.id, { confirmRestricted: true });
    }
  }

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
      <PageHeader
        title="Newsletters & Docs"
        description="Newsletters, survey responses, signed policies, other office documents, and long-term email records from missionary and organization partners. Admin-only — never shown on the public site."
        actions={
          canEdit && (
            <button className="btn" onClick={() => setActiveModal("add-file")}>
              + Upload File
            </button>
          )
        }
      />

      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        extraChips={
          <PartnerFilterChip
            partnerId={filterPartnerId}
            partnerName={filterPartnerName}
            partners={partners}
            onSelect={setPartnerFilter}
            onClear={clearPartnerFilter}
          />
        }
      />

      <Table
        style={{ marginTop: "1rem" }}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage={loading ? "Loading…" : "No files on record."}
        onRowClick={(f) => openFileDetail(f)}
        columns={[
          {
            key: "entityName",
            label: "Partner",
            render: (f) => <span style={{ fontWeight: 600 }}>{f.entityName}</span>,
          },
          { key: "title", label: "Title" },
          { key: "kind", label: "Kind", render: (f) => fileKindLabel(f) },
          { key: "receivedDate", label: "Received", type: "date" },
        ]}
        renderActions={(f) => (
          <>
            {canEdit && enabledFeatures.aiExtraction && isScannable(f) && (
              <button
                type="button"
                className="btn secondary small"
                onClick={(e) => {
                  e.stopPropagation();
                  setScanning(f);
                }}
              >
                Scan for requests
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn danger small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(f);
                }}
              >
                Delete
              </button>
            )}
          </>
        )}
      />
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />

      {activeModal === "add-file" && (
        <QuickActionModal
          title="Upload File"
          onClose={closeModal}
          onSubmit={submitAddFile}
          submitLabel="Upload"
        >
          <PartnerFileFormFields
            form={newFile}
            setForm={setNewFile}
            partnerPicker={
              <label style={{ gridColumn: "1 / -1" }}>
                Partner
                <PartnerSelect
                  partners={partners}
                  value={newFile.partnerId}
                  onChange={(partnerId) => setNewFile((f) => ({ ...f, partnerId }))}
                  required
                />
              </label>
            }
            fileInput={
              <label style={{ gridColumn: "1 / -1" }}>
                File (PDF, Word, Excel, .eml, JPG, or PNG)
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.eml,image/jpeg,image/png"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                  required
                />
              </label>
            }
          />
        </QuickActionModal>
      )}

      {activeModal === "view-file" &&
        fileDetail &&
        (canEdit ? (
          <QuickActionModal title="Newsletter / Doc" onClose={closeModal} onSubmit={submitFileDetail}>
            <PartnerLinkButton partnerId={fileDetail.form.partnerId} partners={partners} />
            <PartnerFileFormFields
              form={fileDetail.form}
              setForm={setFileDetailForm}
              partnerPicker={
                <label style={{ gridColumn: "1 / -1" }} title="Everything but the file itself can be edited.">
                  Partner
                  <PartnerSelect
                    partners={partners}
                    value={fileDetail.form.partnerId}
                    onChange={(partnerId) => setFileDetailForm((f) => ({ ...f, partnerId }))}
                    required
                  />
                </label>
              }
            />
            <button
              type="button"
              className="btn secondary small"
              style={{ marginTop: "0.5rem" }}
              onClick={() => handleDownload(fileDetail)}
            >
              Download File
            </button>
          </QuickActionModal>
        ) : (
          <Modal title="Newsletter / Doc" onClose={closeModal}>
            <PartnerLinkButton partnerId={fileDetail.form.partnerId} partners={partners} />
            <Field
              label="Partner"
              value={partners.find((p) => p.id === fileDetail.form.partnerId)?.displayName}
            />
            <Field label="Kind" value={fileKindLabel(fileDetail.form)} />
            <Field label="Title" value={fileDetail.form.title} />
            <Field label="Received Date" value={formatDateLong(fileDetail.form.receivedDate)} />
            <Field label="Notes" value={fileDetail.form.notes} />
            <button
              type="button"
              className="btn secondary small"
              style={{ marginTop: "0.5rem" }}
              onClick={() => handleDownload(fileDetail)}
            >
              Download File
            </button>
          </Modal>
        ))}

      {scanning && (
        <ExtractionReviewModal
          scan={() => scanWithConfirmation(scanning)}
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
