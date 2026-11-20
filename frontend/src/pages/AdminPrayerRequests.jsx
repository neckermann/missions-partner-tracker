import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPrayerRequests,
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchPartners,
  fetchUrgentRecipientCount,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SourceLink from "../components/admin/SourceLink.jsx";
import PrayerRequestFormFields from "../components/admin/PrayerRequestFormFields.jsx";
import { formatDate, todayInputValue } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, resolveQuickRangeDates } from "../utils/dateRange.js";
import { entityFor, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import useSourceFiles from "../hooks/useSourceFiles.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import { useSettings } from "../context/SettingsContext.jsx";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import UrgentSendConfirmBody from "../components/admin/UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import useFilterState from "../hooks/useFilterState.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";

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
  const { partnerId: filterPartnerId, partnerName: filterPartnerName, clearPartnerFilter } =
    usePartnerUrlFilter();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answeringId, setAnsweringId] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  // Scoped to whichever partner is selected in the add form, or whichever
  // request is being edited -- see the same hook used in AdminOneTimeNeeds.jsx.
  const { sourceFiles, loadSourceFiles } = useSourceFiles();
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
    fetchPartners().then(setPartners).catch(console.error);
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

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newRequest.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (newRequest.approveNow) {
      const text = newRequest.requestText.trim();
      const approved = await confirmDialog({
        title: "Approve and send now?",
        body: <ApproveRestrictedTextConfirmBody text={text} />,
        confirmLabel: "Approve and save",
      });
      if (!approved) return;
    }
    if (newRequest.isUrgent) {
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(newRequest.partnerId);
      const sent = await confirmDialog({
        title: "Send now?",
        body: (
          <UrgentSendConfirmBody
            enabledFeatures={enabledFeatures}
            adminCount={adminCount}
            publicCount={publicCount}
          />
        ),
        confirmLabel: "Send now",
      });
      if (!sent) return;
    }
    setSaving(true);
    try {
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
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add prayer request");
    } finally {
      setSaving(false);
    }
  }

  function startAnswer(request) {
    setAnsweringId(request.id);
    setAnswer({ dateAnswered: todayInputValue(), answeredNote: "" });
  }

  async function submitAnswer(id) {
    try {
      await updatePrayerRequest(id, {
        status: "answered",
        dateAnswered: answer.dateAnswered,
        answeredNote: answer.answeredNote || null,
      });
      setAnsweringId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to record the answer");
    }
  }

  // Deliberately doesn't touch status/dateAnswered/answeredNote -- that
  // workflow already has its own guarded flow (Record Answer, only shown
  // while a request is still open), and letting a generic content-edit
  // form also toggle status risks silently reopening an answered request.
  // This is for fixing the text/category/publicity/notes after the fact,
  // not for redoing the answer workflow.
  function startEdit(request) {
    setEditingId(request.id);
    setEditForm({
      category: request.category,
      requestText: request.requestText,
      dateReceived: String(request.dateReceived).slice(0, 10),
      isPublic: request.isPublic,
      includeInBooklet: request.includeInBooklet,
      notes: request.notes || "",
      sourceFileId: request.sourceFile?.id || null,
    });
    loadSourceFiles(request.partner?.id);
  }

  async function submitEdit(id) {
    const isStrategic = editForm.category === "strategic";
    try {
      await updatePrayerRequest(id, {
        category: editForm.category,
        requestText: editForm.requestText.trim(),
        dateReceived: editForm.dateReceived,
        isPublic: isStrategic ? editForm.isPublic : false,
        includeInBooklet: isStrategic && editForm.isPublic ? editForm.includeInBooklet : false,
        notes: editForm.notes || null,
        sourceFileId: editForm.sourceFileId,
      });
      setEditingId(null);
      setEditForm(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save changes");
    }
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Prayer Requests</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Prayer Request"}
        </button>
      </div>
      <p style={{ color: "#666", marginTop: "0.25rem" }}>
        {requests.length} on file · {answeredCount} answered so far
      </p>

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <PrayerRequestFormFields
            form={newRequest}
            setForm={setNewRequest}
            files={sourceFiles}
            mode="create"
            hasEnabledChannel={hasEnabledChannel}
            canApproveNow={canApproveNow}
            enabledFeatures={enabledFeatures}
            partnerPicker={
              <label style={{ gridColumn: "1 / -1" }}>
                Partner
                <PartnerSelect
                  partners={partners}
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
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Add Prayer Request"}
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

      {loading && <p style={{ color: "#888", marginTop: "1rem" }}>Loading…</p>}
      {visibleRequests.map((request) => {
        const entity = entityFor(request);
        return (
          <div key={request.id} className="repeatable-row" style={{ marginTop: "1rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <div>
                {entity.link ? (
                  <Link to={entity.link}>
                    {entity.name} ({entity.type})
                  </Link>
                ) : (
                  <span>{entity.name}</span>
                )}
              </div>
              <div className="table-actions">
                <button type="button" className="btn secondary small" onClick={() => startEdit(request)}>
                  Edit
                </button>
                {request.status !== "answered" && (
                  <button type="button" className="btn secondary small" onClick={() => startAnswer(request)}>
                    Record Answer
                  </button>
                )}
                <button type="button" className="btn danger small" onClick={() => handleDelete(request)}>
                  Delete
                </button>
              </div>
            </div>

            {editingId === request.id ? (
              <div style={{ marginTop: "0.5rem" }}>
                <PrayerRequestFormFields
                  form={editForm}
                  setForm={setEditForm}
                  files={sourceFiles}
                  mode="edit"
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn small" onClick={() => submitEdit(request.id)}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => {
                      setEditingId(null);
                      setEditForm(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ margin: "0.5rem 0" }}>{request.requestText}</p>
            )}

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Received</div>
                <div>
                  {formatDate(request.dateReceived)} ·{" "}
                  {request.category === "strategic" ? "Strategic" : "Situational"}
                  {request.category === "strategic" && request.isPublic && " · Public"}
                  {request.category === "strategic" &&
                    request.isPublic &&
                    request.includeInBooklet &&
                    " · In booklet"}
                </div>
              </div>
              {/* Same principle as PrayerRequestSection.jsx: only "answered"
                  gets a callout here. "ongoing"/"untracked" show nothing. */}
              {request.status === "answered" && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                    Answered
                  </div>
                  <div style={{ color: "#2a5d3c" }}>
                    {formatDate(request.dateAnswered)}
                    {request.answeredNote && ` — ${request.answeredNote}`}
                  </div>
                </div>
              )}
              {request.notes && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Notes</div>
                  <div>{request.notes}</div>
                </div>
              )}
            </div>
            <SourceLink sourceFile={request.sourceFile} />

            {answeringId === request.id && (
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                  marginTop: "0.75rem",
                }}
              >
                <label>
                  Date Answered
                  <input
                    type="date"
                    value={answer.dateAnswered}
                    onChange={(e) => setAnswer((a) => ({ ...a, dateAnswered: e.target.value }))}
                  />
                </label>
                <label style={{ flex: 1, minWidth: "200px" }}>
                  How was it answered? (optional)
                  <input
                    value={answer.answeredNote}
                    onChange={(e) => setAnswer((a) => ({ ...a, answeredNote: e.target.value }))}
                    placeholder="e.g. The clinic opened safely in March"
                  />
                </label>
                <button type="button" className="btn small" onClick={() => submitAnswer(request.id)}>
                  Save
                </button>
                <button type="button" className="btn secondary small" onClick={() => setAnsweringId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {filteredRequests.length === 0 && (
        <p style={{ color: "#888", marginTop: "1rem" }}>No prayer requests on file.</p>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
      {confirmElement}
    </div>
  );
}
