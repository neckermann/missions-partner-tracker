import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSupportNeeds,
  createSupportNeed,
  updateSupportNeed,
  deleteSupportNeed,
  fetchReachablePartners,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SourceLink from "../components/admin/SourceLink.jsx";
import SupportNeedFormFields from "../components/admin/SupportNeedFormFields.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import Field from "../components/admin/Field.jsx";
import { formatDateLong, formatCurrency as formatMoney } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, resolveQuickRangeDates } from "../utils/dateRange.js";
import { entityFor, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import { supportNeedStatus as statusFor } from "../utils/supportNeedStatus.js";
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
import LastEdited from "../components/shared/LastEdited.jsx";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import useFilterState from "../hooks/useFilterState.js";
import useSendingChurchField from "../hooks/useSendingChurchField.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// Thin binding so the call sites below stay unchanged; the formatting
// itself lives in utils/format.js, which is also where the em-dash
// convention for "no amount recorded" is documented.
const formatCurrency = (amount) => formatMoney(amount, { fallback: "—" });

const emptyFilters = { status: "all", sendingChurch: "all", dateRange: "all", includeArchived: false };

const emptyNewNeed = {
  partnerId: "",
  description: "",
  requestedAmount: "",
  requestDate: "",
  notes: "",
  isUrgent: false,
  approveNow: false,
  sourceFileId: null,
};

// Phase 2 of the UX-rebuild plan: filters (status/date-range/archived) are
// now FilterBar, with status and date-range now real backend query params
// (GET /api/support-needs) -- same reuse as reports/oneTimeNeeds.js's
// existing where-clause logic (status derived from approvedAmount,
// nothing new invented). Kept as a card list rather than moving onto
// <Table>, same reasoning as AdminPrayerRequests.jsx: each row has a
// variable-length description plus two independent inline forms (edit,
// record decision) that don't reduce to table cells without either
// cramming or truncating real content.
export default function AdminOneTimeNeeds() {
  const { enabledFeatures } = useSettings();
  // Whether any channel exists at all to ever deliver a recorded event --
  // see PrayerRequestSection.jsx's own hasEnabledChannel for the full
  // reasoning (shared precondition for "Mark as urgent" and
  // canApproveNow below).
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  const [needs, setNeeds] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const sendingChurchField = useSendingChurchField();
  const fields = useMemo(
    () => [
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "pending", label: "Pending decision" },
          { value: "decided", label: "Decided" },
        ],
      },
      { name: "dateRange", label: "Requested", type: "select", options: DATE_RANGE_OPTIONS },
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
  const { canWrite, isAdmin, isGuest, careTeamSeats, isOnCareTeamFor } = useCurrentUser();
  // Staff do everything. A care team member who isn't staff (#289) has what an
  // editor has for a partner on their team -- add and edit a need -- except
  // recording a decision (that's the committee's), deleting, and "send right
  // away" (their dispatch is held for review).
  const canEdit = canWrite;
  const limited = !canWrite;
  const canAdd = canWrite || careTeamSeats.length > 0;
  const canEditRow = (n) => canWrite || isOnCareTeamFor(n.partnerId);
  // A member can only add for partners on their own team.
  const addablePartners = canWrite ? partners : partners.filter((p) => isOnCareTeamFor(p.id));
  const [activeModal, setActiveModal] = useState(null); // "add" | "view" | "decide" | null
  const [newNeed, setNewNeed] = useState(emptyNewNeed);
  const [decidingNeed, setDecidingNeed] = useState(null);
  const [decision, setDecision] = useState({ approvedAmount: "", approvedDate: "", decisionNote: "" });
  const [needDetail, setNeedDetail] = useState(null); // { id, form }
  // Scoped to whichever partner is selected in the add form, or whichever
  // need is being edited -- see the same hook used in AdminPrayerRequests.jsx.
  const { sourceFiles, loadSourceFiles } = useSourceFiles();
  // No single partnerId prop here -- looked up from whichever partner is
  // currently selected in the add form, same list PartnerSelect renders.
  const selectedPartner = partners.find((p) => p.id === newNeed.partnerId);
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

  function closeModal() {
    setActiveModal(null);
    setNeedDetail(null);
    setDecidingNeed(null);
  }

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.status !== "all") params.status = filters.status;
    if (filters.sendingChurch !== "all") params.sendingChurch = filters.sendingChurch;
    const { from, to } = resolveQuickRangeDates(filters.dateRange);
    if (from) params.from = from;
    if (to) params.to = to;
    if (filterPartnerId) params.partnerId = filterPartnerId;
    fetchSupportNeeds(params)
      .then(setNeeds)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    fetchReachablePartners().then(setPartners).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.sendingChurch, filters.dateRange, filterPartnerId]);

  const filteredNeeds = needs.filter((need) => filters.includeArchived || !need.partner?.archived);
  const {
    visible: visibleNeeds,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(filteredNeeds, {
    initialCount: 25,
    step: 25,
  });

  async function submitAddNeed() {
    if (!newNeed.partnerId) {
      throw new Error("Choose a partner");
    }
    const proceed = await confirmBeforeCreate({
      approveNow: newNeed.approveNow,
      isUrgent: newNeed.isUrgent,
      partnerId: newNeed.partnerId,
      text: newNeed.description.trim(),
    });
    if (!proceed) return false;
    await createSupportNeed({
      partnerId: newNeed.partnerId,
      description: newNeed.description.trim(),
      requestedAmount: Number(newNeed.requestedAmount),
      requestDate: newNeed.requestDate,
      notes: newNeed.notes || null,
      approveNow: newNeed.approveNow,
      isUrgent: newNeed.isUrgent,
      sourceFileId: newNeed.sourceFileId,
    });
    setNewNeed(emptyNewNeed);
    loadSourceFiles(null);
    await reload();
  }

  function openDecision(need) {
    setDecidingNeed(need);
    setDecision({ approvedAmount: "", approvedDate: "", decisionNote: "" });
    setActiveModal("decide");
  }

  async function submitDecision() {
    await updateSupportNeed(decidingNeed.id, {
      approvedAmount: Number(decision.approvedAmount),
      approvedDate: decision.approvedDate,
      decisionNote: decision.decisionNote || null,
    });
    await reload();
  }

  // Deliberately doesn't touch approvedAmount/approvedDate -- that stays
  // the Record Decision flow's job, same reasoning as
  // AdminPrayerRequests.jsx's view/edit popup.
  function openNeedDetail(need) {
    setNeedDetail({
      id: need.id,
      lastEditedByName: need.lastEditedByName,
      lastEditedAt: need.lastEditedAt,
      form: {
        partnerId: need.partner?.id || "",
        description: need.description,
        requestedAmount: String(need.requestedAmount),
        requestDate: String(need.requestDate).slice(0, 10),
        notes: need.notes || "",
        sourceFileId: need.sourceFile?.id || null,
        sourceFile: need.sourceFile || null,
        approvedAmount: need.approvedAmount,
        approvedDate: need.approvedDate,
        decisionNote: need.decisionNote,
      },
    });
    loadSourceFiles(need.partner?.id);
    setActiveModal("view");
  }

  function setNeedDetailForm(updater) {
    setNeedDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitNeedDetail() {
    await updateSupportNeed(needDetail.id, {
      description: needDetail.form.description.trim(),
      requestedAmount: Number(needDetail.form.requestedAmount),
      requestDate: needDetail.form.requestDate,
      notes: needDetail.form.notes || null,
      sourceFileId: needDetail.form.sourceFileId,
    });
    await reload();
  }

  async function handleDelete(need) {
    const entity = entityFor(need);
    const confirmed = await confirmDialog({
      title: `Delete this need request for ${entity.name}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteSupportNeed(need.id);
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
            { label: "One-Time Needs" },
          ]}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>One-Time Needs</h2>
        {canAdd && (
          <button
            className="btn"
            onClick={() => {
              setNewNeed(emptyNewNeed);
              loadSourceFiles(null);
              setActiveModal("add");
            }}
          >
            + Add Need
          </button>
        )}
      </div>

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
        rows={visibleNeeds}
        rowKey={(row) => row.id}
        emptyMessage={loading ? "Loading…" : "No needs on file."}
        onRowClick={(need) => openNeedDetail(need)}
        columns={[
          {
            key: "entityName",
            label: "Partner",
            render: (need) => (
              <>
                <span style={{ fontWeight: 600 }}>{entityFor(need).name}</span>
                {/* "New since your last visit to this list" -- see
                    supportNeeds.js's own comment; a separate, per-user
                    timestamp from the bell's "newOneTimeNeeds" seen-state. */}
                {need.isNew && (
                  <span className="status-pill good" style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>
                    New
                  </span>
                )}
              </>
            ),
          },
          {
            key: "description",
            label: "Description",
            render: (need) => truncate(need.description, 80),
          },
          {
            key: "requestedAmount",
            label: "Requested",
            render: (need) =>
              need.approvedAmount != null && need.approvedAmount !== need.requestedAmount
                ? `${formatCurrency(need.requestedAmount)} → ${formatCurrency(need.approvedAmount)}`
                : formatCurrency(need.requestedAmount),
          },
          {
            key: "status",
            label: "Status",
            render: (need) => statusFor(need).label,
          },
        ]}
        renderActions={(need) => (
          <>
            {canEdit && need.approvedAmount == null && (
              <button
                type="button"
                className="btn secondary small"
                onClick={(e) => {
                  e.stopPropagation();
                  openDecision(need);
                }}
              >
                Record Decision
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn danger small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(need);
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
        <QuickActionModal title="Add One-Time Need" onClose={closeModal} onSubmit={submitAddNeed}>
          <SupportNeedFormFields
            form={newNeed}
            setForm={setNewNeed}
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
                  value={newNeed.partnerId}
                  onChange={(partnerId) => {
                    setNewNeed((f) => ({ ...f, partnerId, sourceFileId: null }));
                    loadSourceFiles(partnerId);
                  }}
                  required
                />
              </label>
            }
          />
        </QuickActionModal>
      )}

      {activeModal === "decide" && decidingNeed && (
        <QuickActionModal
          title="Record Decision"
          onClose={closeModal}
          onSubmit={submitDecision}
          submitLabel="Save Decision"
          submitDisabled={decision.approvedAmount === "" || !decision.approvedDate}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <label>
              Approved Amount ($)
              <input
                type="number"
                min="0"
                value={decision.approvedAmount}
                onChange={(e) => setDecision((d) => ({ ...d, approvedAmount: e.target.value }))}
              />
            </label>
            <label>
              Approved Date
              <input
                type="date"
                value={decision.approvedDate}
                onChange={(e) => setDecision((d) => ({ ...d, approvedDate: e.target.value }))}
              />
            </label>
          </div>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            Decision Note (optional)
            <textarea
              rows={2}
              value={decision.decisionNote}
              onChange={(e) => setDecision((d) => ({ ...d, decisionNote: e.target.value }))}
              placeholder="Why this amount -- declined, partially funded, etc. Shown in the admin notification."
            />
          </label>
        </QuickActionModal>
      )}

      {activeModal === "view" &&
        needDetail &&
        (canEditRow({ partnerId: needDetail.form.partnerId, ...needDetail.form }) ? (
          <QuickActionModal title="One-Time Need" onClose={closeModal} onSubmit={submitNeedDetail}>
            <Link
              to={`/admin/partners/${needDetail.form.partnerId}`}
              style={{ display: "inline-block", marginBottom: "0.75rem" }}
            >
              Go to partner →
            </Link>
            {!isGuest && <LastEdited name={needDetail.lastEditedByName} at={needDetail.lastEditedAt} />}
            <SupportNeedFormFields
              form={needDetail.form}
              setForm={setNeedDetailForm}
              files={sourceFiles}
              mode="edit"
              limited={limited}
            />
            {canEdit && needDetail.form.approvedAmount == null && (
              <button
                type="button"
                className="btn secondary small"
                style={{ marginTop: "0.5rem" }}
                onClick={() => {
                  const need = needs.find((n) => n.id === needDetail.id);
                  closeModal();
                  openDecision(need);
                }}
              >
                Record Decision
              </button>
            )}
          </QuickActionModal>
        ) : (
          <Modal title="One-Time Need" onClose={closeModal}>
            <Link
              to={`/admin/partners/${needDetail.form.partnerId}`}
              style={{ display: "inline-block", marginBottom: "0.75rem" }}
            >
              Go to partner →
            </Link>
            {!isGuest && <LastEdited name={needDetail.lastEditedByName} at={needDetail.lastEditedAt} />}
            <Field label="Description" value={needDetail.form.description} />
            <Field label="Requested Amount" value={formatCurrency(needDetail.form.requestedAmount)} />
            <Field label="Request Date" value={formatDateLong(needDetail.form.requestDate)} />
            <Field label="Notes" value={needDetail.form.notes} />
            <Field
              label="Approved"
              value={
                needDetail.form.approvedAmount != null
                  ? `${formatCurrency(needDetail.form.approvedAmount)} on ${formatDateLong(needDetail.form.approvedDate)}`
                  : "Not yet decided"
              }
              showEmpty
            />
            <Field label="Decision Note" value={needDetail.form.decisionNote} />
            <SourceLink sourceFile={needDetail.form.sourceFile} />
          </Modal>
        ))}
      {confirmElement}
    </div>
  );
}
