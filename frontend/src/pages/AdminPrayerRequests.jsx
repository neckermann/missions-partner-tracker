import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPrayerRequests,
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchReachablePartners,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SourceLink from "../components/admin/SourceLink.jsx";
import PrayerRequestFormFields from "../components/admin/PrayerRequestFormFields.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import Field from "../components/admin/Field.jsx";
import { formatDateLong, todayInputValue } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, resolveQuickRangeDates } from "../utils/dateRange.js";
import { entityFor, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import { truncate } from "../utils/truncate.js";
import useLoadMore from "../hooks/useLoadMore.js";
import useSourceFiles from "../hooks/useSourceFiles.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import useUrgentApprovalGate from "../hooks/useUrgentApprovalGate.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

const emptyFilters = { category: "all", dateRange: "all", includeArchived: false };

const emptyNewRequest = {
  partnerId: "",
  category: "strategic",
  requestText: "",
  dateReceived: todayInputValue(),
  isPublic: false,
  includeInBooklet: false,
  untracked: false,
  isUrgent: false,
  approveNow: false,
  notes: "",
  sourceFileId: null,
};

// Same shape as AdminOneTimeNeeds.jsx, but deliberately without that
// page's "Pending Decision" warning-toned status pill -- an open prayer
// request isn't a problem to flag, see the PrayerRequest model comment
// in schema.prisma. The only status called out here at all is
// "Answered", as a quiet note, not a checklist item.
//
// Phase 2 of the UX-rebuild plan: filters (category/date-range/archived)
// are now FilterBar, with category and date-range now real backend query
// params (GET /api/prayer-requests) -- the exact where-clause logic
// already existed for this dataset's Report version, just not the live
// route. The list body deliberately stays its own card layout rather than
// moving onto the generic <Table>: each row carries a variable-height
// request, an inline edit form, and an independent inline "Record Answer"
// form, none of which reduce to a table cell without either truncating
// real content or cramming an entire form into one <td>. <Table>'s column
// model fits genuinely tabular data (Partners, Trips, Partner Files,
// Monthly Support -- all migrated this phase); this one isn't that
// shape, so forcing it in would be a UX regression dressed up as
// consistency, not the simplification the plan actually asks for.
export default function AdminPrayerRequests() {
  const { enabledFeatures } = useSettings();
  // Whether any channel exists at all to ever deliver a recorded event --
  // see PrayerRequestSection.jsx's own hasEnabledChannel for the full
  // reasoning (shared precondition for "Mark as urgent" and
  // canApproveNow below).
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  const [requests, setRequests] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  // isRestricted isn't a prop here (there's no single partner this page
  // is scoped to) -- looked up from whichever partner is currently
  // selected in the add form instead, same list this page's own
  // PartnerSelect already renders from.
  const fields = useMemo(
    () => [
      {
        name: "category",
        label: "Category",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "strategic", label: "Strategic" },
          { value: "situational", label: "Situational" },
        ],
      },
      { name: "dateRange", label: "Received", type: "select", options: DATE_RANGE_OPTIONS },
      INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD,
    ],
    []
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
  const { canWrite, isAdmin, isGuest, careTeamSeats, isOnCareTeamFor } = useCurrentUser();
  // Staff do everything. A care team member who isn't staff (#289) has what an
  // editor has for a partner on their team -- add, edit, answer -- but never
  // delete, and no "send right away" (their dispatch is held for review).
  const limited = !canWrite;
  const canAdd = canWrite || careTeamSeats.length > 0;
  const canEditRow = (r) => canWrite || isOnCareTeamFor(r.partnerId);
  // A member can only add for partners on their own team.
  const addablePartners = canWrite ? partners : partners.filter((p) => isOnCareTeamFor(p.id));
  const [activeModal, setActiveModal] = useState(null); // "add" | "view" | "answer" | null
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [answeringRequest, setAnsweringRequest] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });
  const [requestDetail, setRequestDetail] = useState(null); // { id, form }
  // Scoped to whichever partner is selected in the add form, or whichever
  // request is being viewed/edited -- see the same hook used in
  // AdminOneTimeNeeds.jsx.
  const { sourceFiles, loadSourceFiles } = useSourceFiles();

  function closeModal() {
    setActiveModal(null);
    setRequestDetail(null);
    setAnsweringRequest(null);
  }
  const selectedPartner = partners.find((p) => p.id === newRequest.partnerId);
  // Also requires allowRestrictedPartnerDispatch, defaulting to true
  // while loading -- a UI convenience gate only, the real check is still
  // enforced server-side regardless.
  const { settings } = useChurchSettings();
  const allowRestrictedPartnerDispatch = settings?.allowRestrictedPartnerDispatch !== false;
  const canApproveNow =
    !!selectedPartner?.isRestricted && hasEnabledChannel && allowRestrictedPartnerDispatch;
  // Named confirmDialog, not confirm -- this page's only confirmation
  // surface now (approve-now, urgent-send, and delete all route through
  // it), and `confirm` would read as a reference to the native global
  // this hook replaces.
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const confirmBeforeCreate = useUrgentApprovalGate({ confirmDialog, enabledFeatures });

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.category !== "all") params.category = filters.category;
    const { from, to } = resolveQuickRangeDates(filters.dateRange);
    if (from) params.from = from;
    if (to) params.to = to;
    if (filterPartnerId) params.partnerId = filterPartnerId;
    fetchPrayerRequests(params)
      .then(setRequests)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    fetchReachablePartners().then(setPartners).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.dateRange, filterPartnerId]);

  const filteredRequests = requests.filter((r) => filters.includeArchived || !r.partner?.archived);
  const answeredCount = requests.filter((r) => r.status === "answered").length;
  const {
    visible: visibleRequests,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(filteredRequests, {
    initialCount: 25,
    step: 25,
  });

  async function submitAddRequest() {
    if (!newRequest.partnerId) {
      throw new Error("Choose a partner");
    }
    const proceed = await confirmBeforeCreate({
      approveNow: newRequest.approveNow,
      isUrgent: newRequest.isUrgent,
      partnerId: newRequest.partnerId,
      text: newRequest.requestText.trim(),
    });
    if (!proceed) return false;
    const isStrategic = newRequest.category === "strategic";
    await createPrayerRequest({
      partnerId: newRequest.partnerId,
      category: newRequest.category,
      requestText: newRequest.requestText.trim(),
      dateReceived: newRequest.dateReceived,
      isPublic: isStrategic ? newRequest.isPublic : false,
      includeInBooklet: isStrategic && newRequest.isPublic ? newRequest.includeInBooklet : false,
      status: newRequest.untracked ? "untracked" : "ongoing",
      isUrgent: newRequest.isUrgent,
      approveNow: newRequest.approveNow,
      notes: newRequest.notes || null,
      sourceFileId: newRequest.sourceFileId,
    });
    setNewRequest(emptyNewRequest);
    loadSourceFiles(null);
    await reload();
  }

  function openAnswer(request) {
    setAnsweringRequest(request);
    setAnswer({ dateAnswered: todayInputValue(), answeredNote: "" });
    setActiveModal("answer");
  }

  async function submitAnswer() {
    await updatePrayerRequest(answeringRequest.id, {
      status: "answered",
      dateAnswered: answer.dateAnswered,
      answeredNote: answer.answeredNote || null,
    });
    await reload();
  }

  // Deliberately doesn't touch status/dateAnswered/answeredNote -- that
  // workflow already has its own guarded flow (Record Answer, only shown
  // while a request is still open), and letting a generic content-edit
  // form also toggle status risks silently reopening an answered request.
  // This is for fixing the text/category/publicity/notes after the fact,
  // not for redoing the answer workflow.
  function openRequestDetail(request) {
    setRequestDetail({
      id: request.id,
      form: {
        partnerId: request.partner?.id || "",
        category: request.category,
        requestText: request.requestText,
        dateReceived: String(request.dateReceived).slice(0, 10),
        isPublic: request.isPublic,
        includeInBooklet: request.includeInBooklet,
        notes: request.notes || "",
        sourceFileId: request.sourceFile?.id || null,
        sourceFile: request.sourceFile || null,
        status: request.status,
        dateAnswered: request.dateAnswered,
        answeredNote: request.answeredNote,
      },
    });
    loadSourceFiles(request.partner?.id);
    setActiveModal("view");
  }

  function setRequestDetailForm(updater) {
    setRequestDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitRequestDetail() {
    const isStrategic = requestDetail.form.category === "strategic";
    await updatePrayerRequest(requestDetail.id, {
      category: requestDetail.form.category,
      requestText: requestDetail.form.requestText.trim(),
      dateReceived: requestDetail.form.dateReceived,
      isPublic: isStrategic ? requestDetail.form.isPublic : false,
      includeInBooklet:
        isStrategic && requestDetail.form.isPublic ? requestDetail.form.includeInBooklet : false,
      notes: requestDetail.form.notes || null,
      sourceFileId: requestDetail.form.sourceFileId,
    });
    await reload();
  }

  async function handleDelete(request) {
    const entity = entityFor(request);
    const confirmed = await confirmDialog({
      title: `Delete this prayer request for ${entity.name}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deletePrayerRequest(request.id);
    reload();
  }

  return (
    <div className="admin-shell">
      {filterPartnerId && (
        <Breadcrumb
          items={[
            // A guest has no Partners directory to go back to.
            ...(isGuest ? [] : [{ label: "Partners", to: "/admin/partners" }]),
            { label: filterPartnerName || "…", to: `/admin/partners/${filterPartnerId}` },
            { label: "Prayer Requests" },
          ]}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Prayer Requests</h2>
        {canAdd && (
          <button
            className="btn"
            onClick={() => {
              setNewRequest(emptyNewRequest);
              loadSourceFiles(null);
              setActiveModal("add");
            }}
          >
            + Add Prayer Request
          </button>
        )}
      </div>
      <p style={{ color: "#666", marginTop: "0.25rem" }}>
        {requests.length} on file · {answeredCount} answered so far
      </p>

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
        rows={visibleRequests}
        rowKey={(row) => row.id}
        emptyMessage={loading ? "Loading…" : "No prayer requests on file."}
        onRowClick={(request) => openRequestDetail(request)}
        columns={[
          {
            key: "entityName",
            label: "Partner",
            render: (request) => (
              <>
                <span style={{ fontWeight: 600 }}>{entityFor(request).name}</span>
                {/* "New since your last visit to this list" -- a separate,
                    per-user timestamp from the bell's own "newPrayerRequests"
                    seen-state (see prayerRequests.js's own comment on why).
                    Clears on this list's next load, not per-item. */}
                {request.isNew && (
                  <span className="status-pill good" style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>
                    New
                  </span>
                )}
              </>
            ),
          },
          {
            key: "category",
            label: "Category",
            render: (request) => (request.category === "strategic" ? "Strategic" : "Situational"),
          },
          { key: "requestText", label: "Request", render: (request) => truncate(request.requestText, 80) },
          {
            key: "status",
            label: "Status",
            render: (request) => (request.status === "answered" ? "Answered" : "Ongoing"),
          },
        ]}
        renderActions={(request) => (
          <>
            {canEditRow(request) && request.status !== "answered" && (
              <button
                type="button"
                className="btn secondary small"
                onClick={(e) => {
                  e.stopPropagation();
                  openAnswer(request);
                }}
              >
                Record Answer
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn danger small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(request);
                }}
              >
                Delete
              </button>
            )}
          </>
        )}
      />
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />

      {activeModal === "add" && (
        <QuickActionModal title="Add Prayer Request" onClose={closeModal} onSubmit={submitAddRequest}>
          <PrayerRequestFormFields
            form={newRequest}
            setForm={setNewRequest}
            files={sourceFiles}
            mode="create"
            limited={limited}
            hasEnabledChannel={hasEnabledChannel}
            canApproveNow={canApproveNow}
            enabledFeatures={enabledFeatures}
            partnerPicker={
              <label style={{ gridColumn: "1 / -1" }}>
                Partner
                <PartnerSelect
                  partners={addablePartners}
                  value={newRequest.partnerId}
                  onChange={(partnerId) => {
                    setNewRequest((f) => ({ ...f, partnerId, sourceFileId: null }));
                    loadSourceFiles(partnerId);
                  }}
                  required
                />
              </label>
            }
          />
        </QuickActionModal>
      )}

      {activeModal === "answer" && answeringRequest && (
        <QuickActionModal title="Record Answer" onClose={closeModal} onSubmit={submitAnswer}>
          <label>
            Date Answered
            <input
              type="date"
              value={answer.dateAnswered}
              onChange={(e) => setAnswer((a) => ({ ...a, dateAnswered: e.target.value }))}
            />
          </label>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            How was it answered? (optional)
            <input
              value={answer.answeredNote}
              onChange={(e) => setAnswer((a) => ({ ...a, answeredNote: e.target.value }))}
              placeholder="e.g. The clinic opened safely in March"
            />
          </label>
        </QuickActionModal>
      )}

      {activeModal === "view" &&
        requestDetail &&
        (canEditRow({ partnerId: requestDetail.form.partnerId, ...requestDetail.form }) ? (
          <QuickActionModal title="Prayer Request" onClose={closeModal} onSubmit={submitRequestDetail}>
            <Link
              to={`/admin/partners/${requestDetail.form.partnerId}`}
              style={{ display: "inline-block", marginBottom: "0.75rem" }}
            >
              Go to partner →
            </Link>
            <PrayerRequestFormFields
              form={requestDetail.form}
              setForm={setRequestDetailForm}
              files={sourceFiles}
              mode="edit"
              limited={limited}
            />
            {requestDetail.form.status !== "answered" && (
              <button
                type="button"
                className="btn secondary small"
                style={{ marginTop: "0.5rem" }}
                onClick={() => {
                  const request = requests.find((r) => r.id === requestDetail.id);
                  closeModal();
                  openAnswer(request);
                }}
              >
                Record Answer
              </button>
            )}
          </QuickActionModal>
        ) : (
          <Modal title="Prayer Request" onClose={closeModal}>
            <Link
              to={`/admin/partners/${requestDetail.form.partnerId}`}
              style={{ display: "inline-block", marginBottom: "0.75rem" }}
            >
              Go to partner →
            </Link>
            <Field
              label="Category"
              value={requestDetail.form.category === "strategic" ? "Strategic" : "Situational"}
            />
            <Field label="Date Received" value={formatDateLong(requestDetail.form.dateReceived)} />
            <Field label="Prayer Request" value={requestDetail.form.requestText} />
            <Field label="Admin Notes" value={requestDetail.form.notes} />
            <SourceLink sourceFile={requestDetail.form.sourceFile} />
            {requestDetail.form.status === "answered" && (
              <Field
                label="Answered"
                value={`${formatDateLong(requestDetail.form.dateAnswered)}${
                  requestDetail.form.answeredNote ? ` — ${requestDetail.form.answeredNote}` : ""
                }`}
              />
            )}
          </Modal>
        ))}
      {confirmElement}
    </div>
  );
}
