import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSupportNeeds,
  createSupportNeed,
  updateSupportNeed,
  deleteSupportNeed,
  fetchPartners,
  fetchUrgentRecipientCount,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SourceLink from "../components/admin/SourceLink.jsx";
import SupportNeedFormFields from "../components/admin/SupportNeedFormFields.jsx";
import { formatDate, formatCurrency as formatMoney } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, resolveQuickRangeDates } from "../utils/dateRange.js";
import { entityFor } from "../utils/partnerEntity.js";
import { supportNeedStatus as statusFor } from "../utils/supportNeedStatus.js";
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
import useFilterState from "../hooks/useFilterState.js";

// Thin binding so the call sites below stay unchanged; the formatting
// itself lives in utils/format.js, which is also where the em-dash
// convention for "no amount recorded" is documented.
const formatCurrency = (amount) => formatMoney(amount, { fallback: "—" });

const emptyFilters = { status: "all", dateRange: "all", includeArchived: false };

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
      { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
    ],
    []
  );
  const { values: filters, setValue: updateFilter, reset: resetFilters } = useFilterState(fields, emptyFilters);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNeed, setNewNeed] = useState(emptyNewNeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [decision, setDecision] = useState({ approvedAmount: "", approvedDate: "", decisionNote: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
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

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.status !== "all") params.status = filters.status;
    const { from, to } = resolveQuickRangeDates(filters.dateRange);
    if (from) params.from = from;
    if (to) params.to = to;
    fetchSupportNeeds(params)
      .then(setNeeds)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.dateRange]);

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

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newNeed.partnerId) {
      setError("Choose a partner");
      return;
    }
    if (newNeed.approveNow) {
      const text = newNeed.description.trim();
      const approved = await confirmDialog({
        title: "Approve and send now?",
        body: <ApproveRestrictedTextConfirmBody text={text} />,
        confirmLabel: "Approve and save",
      });
      if (!approved) return;
    }
    if (newNeed.isUrgent) {
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(newNeed.partnerId);
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
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add need");
    } finally {
      setSaving(false);
    }
  }

  function startDecision(need) {
    setDecidingId(need.id);
    setDecision({ approvedAmount: "", approvedDate: "", decisionNote: "" });
  }

  async function submitDecision(needId) {
    try {
      await updateSupportNeed(needId, {
        approvedAmount: Number(decision.approvedAmount),
        approvedDate: decision.approvedDate,
        decisionNote: decision.decisionNote || null,
      });
      setDecidingId(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record decision");
    }
  }

  // Deliberately doesn't touch approvedAmount/approvedDate -- that stays
  // the Record Decision flow's job, same reasoning as
  // AdminPrayerRequests.jsx's startEdit/submitEdit.
  function startEdit(need) {
    setEditingId(need.id);
    setEditForm({
      description: need.description,
      requestedAmount: String(need.requestedAmount),
      requestDate: String(need.requestDate).slice(0, 10),
      notes: need.notes || "",
      sourceFileId: need.sourceFile?.id || null,
    });
    loadSourceFiles(need.partner?.id);
  }

  async function submitEdit(id) {
    try {
      await updateSupportNeed(id, {
        description: editForm.description.trim(),
        requestedAmount: Number(editForm.requestedAmount),
        requestDate: editForm.requestDate,
        notes: editForm.notes || null,
        sourceFileId: editForm.sourceFileId,
      });
      setEditingId(null);
      setEditForm(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save changes");
    }
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>One-Time Needs</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Need"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <SupportNeedFormFields
            form={newNeed}
            setForm={setNewNeed}
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
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Add Need"}
            </button>
          </div>
        </form>
      )}

      <FilterBar fields={fields} values={filters} onChange={updateFilter} onReset={resetFilters} />

      {loading && <p style={{ color: "#888", marginTop: "1rem" }}>Loading…</p>}
      {visibleNeeds.map((need) => {
        const entity = entityFor(need);
        const status = statusFor(need);
        return (
          <div key={need.id} className="repeatable-row" style={{ marginTop: "1rem" }}>
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
                <span className={`status-pill ${status.tone}`} style={{ marginRight: "0.5rem" }}>
                  {status.label}
                </span>
                {entity.link ? (
                  <Link to={entity.link}>
                    {entity.name} ({entity.type})
                  </Link>
                ) : (
                  <span>{entity.name}</span>
                )}
              </div>
              <div className="table-actions">
                <button type="button" className="btn secondary small" onClick={() => startEdit(need)}>
                  Edit
                </button>
                <button className="btn danger small" onClick={() => handleDelete(need)}>
                  Delete
                </button>
              </div>
            </div>

            {editingId === need.id ? (
              <div style={{ marginTop: "0.5rem" }}>
                <SupportNeedFormFields form={editForm} setForm={setEditForm} files={sourceFiles} mode="edit" />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn small" onClick={() => submitEdit(need.id)}>
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
              <>
                <p style={{ margin: "0.5rem 0" }}>{need.description}</p>

                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                      Requested
                    </div>
                    <div>
                      {formatCurrency(need.requestedAmount)} on {formatDate(need.requestDate)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                      Approved
                    </div>
                    <div>
                      {need.approvedAmount != null
                        ? `${formatCurrency(need.approvedAmount)} on ${formatDate(need.approvedDate)}`
                        : "Not yet decided"}
                    </div>
                  </div>
                  {need.notes && (
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                        Notes
                      </div>
                      <div>{need.notes}</div>
                    </div>
                  )}
                  {need.decisionNote && (
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                        Decision Note
                      </div>
                      <div>{need.decisionNote}</div>
                    </div>
                  )}
                </div>
                <SourceLink sourceFile={need.sourceFile} />
              </>
            )}

            {need.approvedAmount == null && (
              <div style={{ marginTop: "0.75rem" }}>
                {decidingId === need.id ? (
                  <div>
                    <div
                      style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}
                    >
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
                    <label style={{ display: "block", marginTop: "0.75rem", maxWidth: "28rem" }}>
                      Decision Note (optional)
                      <textarea
                        rows={2}
                        value={decision.decisionNote}
                        onChange={(e) => setDecision((d) => ({ ...d, decisionNote: e.target.value }))}
                        placeholder="Why this amount -- declined, partially funded, etc. Shown in the admin notification."
                      />
                    </label>
                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => submitDecision(need.id)}
                        disabled={decision.approvedAmount === "" || !decision.approvedDate}
                      >
                        Save Decision
                      </button>
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => setDecidingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn secondary small" onClick={() => startDecision(need)}>
                    Record Decision
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {filteredNeeds.length === 0 && <p style={{ color: "#888", marginTop: "1rem" }}>No needs on file.</p>}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
      {confirmElement}
    </div>
  );
}
