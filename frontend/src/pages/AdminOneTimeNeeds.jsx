import React, { useEffect, useState } from "react";
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
import SourcePicker from "../components/admin/SourcePicker.jsx";
import { formatDate, formatCurrency as formatMoney } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, inDateRange } from "../utils/dateRange.js";
import { urgentSendDescription } from "../utils/urgentSend.js";
import { entityFor } from "../utils/partnerEntity.js";
import { supportNeedStatus as statusFor } from "../utils/supportNeedStatus.js";
import useLoadMore from "../hooks/useLoadMore.js";
import useSourceFiles from "../hooks/useSourceFiles.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import useAllowRestrictedPartnerNotifications from "../hooks/useAllowRestrictedPartnerNotifications.js";
import { useSettings } from "../context/SettingsContext.jsx";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import UrgentSendConfirmBody from "../components/admin/UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// Thin binding so the call sites below stay unchanged; the formatting
// itself lives in utils/format.js, which is also where the em-dash
// convention for "no amount recorded" is documented.
const formatCurrency = (amount) => formatMoney(amount, { fallback: "—" });

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
  const [statusFilter, setStatusFilter] = useState("all"); // all | pending | decided
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
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
  // Also requires allowRestrictedPartnerNotifications -- see
  // useAllowRestrictedPartnerNotifications's own comment.
  const allowRestrictedPartnerNotifications = useAllowRestrictedPartnerNotifications();
  const canApproveNow =
    !!selectedPartner?.isRestricted && hasEnabledChannel && allowRestrictedPartnerNotifications;
  // Named confirmDialog, not confirm -- this page's only confirmation
  // surface now (approve-now, urgent-send, and delete all route through
  // it), and `confirm` would read as a reference to the native global
  // this hook replaces.
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  function reload() {
    fetchSupportNeeds().then(setNeeds).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  const filteredNeeds = needs.filter((need) => {
    if (statusFilter === "pending" && need.approvedAmount != null) return false;
    if (statusFilter === "decided" && need.approvedAmount == null) return false;
    return inDateRange(need.requestDate, dateRangeFilter);
  });
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
          <div className="form-grid">
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
            <label style={{ gridColumn: "1 / -1" }}>
              Description
              <input
                value={newNeed.description}
                onChange={(e) => setNewNeed((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. One-time gift to help a family in their congregation"
                required
              />
            </label>
            <label>
              Requested Amount ($)
              <input
                type="number"
                min="0"
                value={newNeed.requestedAmount}
                onChange={(e) => setNewNeed((f) => ({ ...f, requestedAmount: e.target.value }))}
                required
              />
            </label>
            <label>
              Request Date
              <input
                type="date"
                value={newNeed.requestDate}
                onChange={(e) => setNewNeed((f) => ({ ...f, requestDate: e.target.value }))}
                required
              />
            </label>
            <SourcePicker
              files={sourceFiles}
              sourceFileId={newNeed.sourceFileId}
              onChange={(source) => setNewNeed((f) => ({ ...f, ...source }))}
            />
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={newNeed.notes}
                onChange={(e) => setNewNeed((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            {hasEnabledChannel && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={newNeed.isUrgent}
                      onChange={(e) => setNewNeed((f) => ({ ...f, isUrgent: e.target.checked }))}
                    />
                    Mark as urgent -- send right away
                  </label>
                </div>
                <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                  {urgentSendDescription(enabledFeatures)}
                </p>
              </div>
            )}
            {canApproveNow && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={newNeed.approveNow}
                      onChange={(e) => setNewNeed((f) => ({ ...f, approveNow: e.target.checked }))}
                    />
                    Review and approve now
                  </label>
                </div>
                <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                  This partner is restricted, so nothing above sends anywhere until an admin or editor reviews
                  it -- normally from the Pending Notifications page afterward. Checking this confirms, right
                  now, that the text you just typed is safe to send verbatim, skipping that extra trip. You'll
                  be asked to confirm the exact wording before saving.
                </p>
              </div>
            )}
          </div>
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Add Need"}
            </button>
          </div>
        </form>
      )}

      <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
        <label
          htmlFor="needs-status-filter"
          style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}
        >
          Show:
        </label>
        <select
          id="needs-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          <option value="all">All</option>
          <option value="pending">Pending decision</option>
          <option value="decided">Decided</option>
        </select>
        <label
          htmlFor="needs-date-range-filter"
          style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}
        >
          Requested:
        </label>
        <select
          id="needs-date-range-filter"
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
              <div className="form-grid" style={{ marginTop: "0.5rem" }}>
                <label style={{ gridColumn: "1 / -1" }}>
                  Description
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Requested Amount ($)
                  <input
                    type="number"
                    min="0"
                    value={editForm.requestedAmount}
                    onChange={(e) => setEditForm((f) => ({ ...f, requestedAmount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Request Date
                  <input
                    type="date"
                    value={editForm.requestDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, requestDate: e.target.value }))}
                    required
                  />
                </label>
                <SourcePicker
                  files={sourceFiles}
                  sourceFileId={editForm.sourceFileId}
                  onChange={(source) => setEditForm((f) => ({ ...f, ...source }))}
                />
                <label style={{ gridColumn: "1 / -1" }}>
                  Notes
                  <input
                    value={editForm.notes}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem" }}>
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
