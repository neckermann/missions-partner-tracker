import React, { useState } from "react";
import {
  todayInputValue,
  toDateInputValue,
  formatDate,
  formatDateLong,
  formatCurrency,
} from "../../utils/format.js";
import {
  createSupportEntry,
  deleteSupportEntry,
  createSupportNeed,
  updateSupportNeed,
  deleteSupportNeed,
  fetchUrgentRecipientCount,
} from "../../api/client.js";
import EditableSection from "./EditableSection.jsx";
import useLoadMore from "../../hooks/useLoadMore.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../../hooks/useChurchSettings.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import LoadMoreButton from "../LoadMoreButton.jsx";
import SourceLink from "./SourceLink.jsx";
import SupportEntryFormFields from "./SupportEntryFormFields.jsx";
import SupportNeedFormFields from "./SupportNeedFormFields.jsx";
import { supportNeedStatus as needStatus } from "../../utils/supportNeedStatus.js";
import UrgentSendConfirmBody from "./UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "./ApproveRestrictedTextConfirmBody.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";

// Monthly support and one-time needs for one partner, editable here rather
// than only from the consolidated admin pages. Same endpoints either way.
//
// Support entries have no edit: an entry records what the amount was set to
// as of a date, like a line in a ledger, so correcting one means deleting it
// and adding another. The API has no update route for them at all.

const emptyEntry = { amount: "", effectiveDate: todayInputValue(), notes: "" };
const emptyNeed = {
  description: "",
  requestedAmount: "",
  requestDate: todayInputValue(),
  notes: "",
  isUrgent: false,
  approveNow: false,
  sourceFileId: null,
};

export default function PartnerFinancialSection({
  partnerId,
  isRestricted,
  supportEntries,
  needRequests,
  files,
  showMonthlySupport,
  showOneTimeNeeds,
  supportingSince,
  onSaveSupportingSince,
  onChange,
}) {
  const { enabledFeatures } = useSettings();
  // Whether any channel exists at all to ever deliver a recorded event --
  // see PrayerRequestSection.jsx's own hasEnabledChannel for the full
  // reasoning (shared precondition for "Mark as urgent" and
  // canApproveNow below, not an "urgent-only" check despite the old
  // name this was renamed from). canApproveNow additionally requires
  // allowRestrictedPartnerDispatch, defaulting to true while
  // loading -- a UI convenience gate only, the real check is still
  // enforced server-side regardless.
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  const { settings } = useChurchSettings();
  const allowRestrictedPartnerDispatch = settings?.allowRestrictedPartnerDispatch !== false;
  const canApproveNow = isRestricted && hasEnabledChannel && allowRestrictedPartnerDispatch;
  // Named confirmDialog, not confirm -- this file's only confirmation
  // surface now (approve-now, urgent-send, and both deletes all route
  // through it), and `confirm` would read as a reference to the native
  // global this hook replaces.
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [addingEntry, setAddingEntry] = useState(false);
  const [entry, setEntry] = useState(emptyEntry);
  const [addingNeed, setAddingNeed] = useState(false);
  const [need, setNeed] = useState(emptyNeed);
  const [decidingId, setDecidingId] = useState(null);
  const [decision, setDecision] = useState({
    approvedAmount: "",
    approvedDate: todayInputValue(),
    decisionNote: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const current = supportEntries?.[0];
  const entriesLoadMore = useLoadMore(supportEntries);
  const needsLoadMore = useLoadMore(needRequests);

  function fail(err, fallback) {
    setError(err.response?.data?.error?.[0]?.message || err.response?.data?.error || fallback);
  }

  async function submitEntry(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createSupportEntry({
        partnerId,
        amount: entry.amount,
        effectiveDate: entry.effectiveDate,
        notes: entry.notes || null,
      });
      setEntry(emptyEntry);
      setAddingEntry(false);
      await onChange();
    } catch (err) {
      fail(err, "Failed to add support entry");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(row) {
    const confirmed = await confirmDialog({
      title: "Delete this support entry?",
      body: (
        <ConfirmMessageBody>
          Delete the {formatCurrency(row.amount)} entry effective {formatDate(row.effectiveDate)}?
        </ConfirmMessageBody>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteSupportEntry(row.id);
    await onChange();
  }

  async function submitNeed(e) {
    e.preventDefault();
    setError("");
    if (need.approveNow) {
      const text = need.description.trim();
      const approved = await confirmDialog({
        title: "Approve and send now?",
        body: <ApproveRestrictedTextConfirmBody text={text} />,
        confirmLabel: "Approve and save",
      });
      if (!approved) return;
    }
    if (need.isUrgent) {
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(partnerId);
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
        partnerId,
        description: need.description.trim(),
        requestedAmount: Number(need.requestedAmount),
        requestDate: need.requestDate,
        notes: need.notes || null,
        isUrgent: need.isUrgent,
        approveNow: need.approveNow,
        sourceFileId: need.sourceFileId,
      });
      setNeed(emptyNeed);
      setAddingNeed(false);
      await onChange();
    } catch (err) {
      fail(err, "Failed to add need");
    } finally {
      setSaving(false);
    }
  }

  async function submitDecision(id) {
    setSaving(true);
    setError("");
    try {
      await updateSupportNeed(id, {
        approvedAmount: Number(decision.approvedAmount),
        approvedDate: decision.approvedDate,
        decisionNote: decision.decisionNote || null,
      });
      setDecidingId(null);
      await onChange();
    } catch (err) {
      fail(err, "Failed to record the decision");
    } finally {
      setSaving(false);
    }
  }

  async function removeNeed(row) {
    const confirmed = await confirmDialog({
      title: "Delete this need?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteSupportNeed(row.id);
    await onChange();
  }

  return (
    <>
      <EditableSection
        title="Supporting Since"
        onSaved={onChange}
        onSave={(d) => onSaveSupportingSince(d.supportingSince || null)}
        value={{ supportingSince: toDateInputValue(supportingSince) }}
        view={() => (
          <p>{formatDateLong(supportingSince) || <span style={{ color: "#888" }}>Not set.</span>}</p>
        )}
        edit={(d, set) => (
          <label style={{ maxWidth: "220px" }}>
            Supporting Since
            <input
              type="date"
              value={d.supportingSince}
              onChange={(e) => set("supportingSince", e.target.value)}
            />
          </label>
        )}
      />
      {showMonthlySupport && (
        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ flex: 1, marginBottom: 0 }}>Financial Support</h3>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => (setAddingEntry((v) => !v), setError(""))}
              title="A new amount takes effect as of its date -- earlier entries stay on file as history."
            >
              {addingEntry ? "Cancel" : "+ Add Support Entry"}
            </button>
          </div>

          <div style={{ margin: "1rem 0" }}>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
              Current Monthly Support
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              {formatCurrency(current?.amount) ?? "—"}
            </div>
          </div>

          {addingEntry && (
            <form onSubmit={submitEntry} style={{ marginBottom: "1rem" }}>
              <SupportEntryFormFields form={entry} setForm={setEntry} />
              <button type="submit" className="btn small" style={{ marginTop: "0.75rem" }} disabled={saving}>
                {saving ? "Saving..." : "Add Entry"}
              </button>
            </form>
          )}

          {supportEntries?.length > 0 ? (
            entriesLoadMore.visible.map((row) => (
              <div key={row.id} className="repeatable-row">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                    <strong>{formatCurrency(row.amount)}</strong>
                    <span style={{ color: "#666" }}>effective {formatDate(row.effectiveDate)}</span>
                    {row.notes && <span style={{ color: "#666" }}>{row.notes}</span>}
                  </div>
                  <div className="table-actions">
                    <button type="button" className="btn danger small" onClick={() => removeEntry(row)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: "#888" }}>No support history on file.</p>
          )}
          <LoadMoreButton
            hasMore={entriesLoadMore.hasMore}
            remaining={entriesLoadMore.remaining}
            onClick={entriesLoadMore.showMore}
            size="small"
          />
        </div>
      )}

      {showOneTimeNeeds && (
        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ flex: 1, marginBottom: 0 }}>One-Time Needs</h3>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => (setAddingNeed((v) => !v), setError(""))}
            >
              {addingNeed ? "Cancel" : "+ Add Need"}
            </button>
          </div>

          {addingNeed && (
            <form onSubmit={submitNeed} style={{ margin: "1rem 0" }}>
              <SupportNeedFormFields
                form={need}
                setForm={setNeed}
                files={files}
                mode="create"
                hasEnabledChannel={hasEnabledChannel}
                canApproveNow={canApproveNow}
                enabledFeatures={enabledFeatures}
              />
              <button type="submit" className="btn small" style={{ marginTop: "0.75rem" }} disabled={saving}>
                {saving ? "Saving..." : "Add Need"}
              </button>
            </form>
          )}

          {needRequests?.length > 0 ? (
            needsLoadMore.visible.map((row) => {
              const status = needStatus(row);
              return (
                <div key={row.id} className="repeatable-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <span className={`status-pill ${status.tone}`}>{status.label}</span>
                      <div style={{ marginTop: "0.4rem" }}>{row.description}</div>
                      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                        Requested {formatCurrency(row.requestedAmount)} on {formatDate(row.requestDate)}
                        {row.approvedAmount != null &&
                          ` · Approved ${formatCurrency(row.approvedAmount)}${
                            row.approvedDate ? ` on ${formatDate(row.approvedDate)}` : ""
                          }`}
                      </div>
                      <SourceLink sourceFile={row.sourceFile} />
                      {row.notes && (
                        <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                          {row.notes}
                        </div>
                      )}
                      {row.decisionNote && (
                        <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                          <strong>Decision note:</strong> {row.decisionNote}
                        </div>
                      )}
                    </div>
                    <div className="table-actions">
                      {row.approvedAmount == null && (
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => {
                            setDecidingId(decidingId === row.id ? null : row.id);
                            setDecision({
                              approvedAmount: "",
                              approvedDate: todayInputValue(),
                              decisionNote: "",
                            });
                            setError("");
                          }}
                        >
                          {decidingId === row.id ? "Cancel" : "Record Decision"}
                        </button>
                      )}
                      <button type="button" className="btn danger small" onClick={() => removeNeed(row)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {decidingId === row.id && (
                    <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                      <label title="Enter 0 to record that the request was declined.">
                        Approved Amount (USD)
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
                      <label style={{ gridColumn: "1 / -1" }}>
                        Decision Note (optional)
                        <textarea
                          rows={2}
                          value={decision.decisionNote}
                          onChange={(e) => setDecision((d) => ({ ...d, decisionNote: e.target.value }))}
                          placeholder="Why this amount -- declined, partially funded, etc. Shown in the admin notification."
                        />
                      </label>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => submitDecision(row.id)}
                          disabled={saving}
                        >
                          Save Decision
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p style={{ color: "#888" }}>No needs on file.</p>
          )}
          <LoadMoreButton
            hasMore={needsLoadMore.hasMore}
            remaining={needsLoadMore.remaining}
            onClick={needsLoadMore.showMore}
            size="small"
          />
        </div>
      )}

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {confirmElement}
    </>
  );
}
