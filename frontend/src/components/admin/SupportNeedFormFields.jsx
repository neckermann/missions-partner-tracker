import React from "react";
import SourcePicker from "./SourcePicker.jsx";
import { urgentSendDescription } from "../../utils/urgentSend.js";

// Phase 2 of the UX-rebuild plan: the one-time-need field set duplicated
// between PartnerFinancialSection.jsx (embedded, fixed partnerId -- add +
// decide only, no edit) and AdminOneTimeNeeds.jsx (consolidated, partner
// picked from a dropdown -- add, edit, and decide). Same pattern as
// PrayerRequestFormFields.jsx: renders only the form-grid body, `mode`
// controls the create-only isUrgent/approveNow blocks, `partnerPicker` is
// injected when given.
export default function SupportNeedFormFields({
  form,
  setForm,
  files,
  mode = "edit",
  hasEnabledChannel,
  canApproveNow,
  enabledFeatures,
  partnerPicker,
}) {
  return (
    <div className="form-grid">
      {partnerPicker}
      <label style={{ gridColumn: "1 / -1" }}>
        Description
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder={
            mode === "create" ? "e.g. One-time gift to help a family in their congregation" : undefined
          }
          required
        />
      </label>
      <label>
        Requested Amount ($)
        <input
          type="number"
          min="0"
          value={form.requestedAmount}
          onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))}
          required
        />
      </label>
      <label>
        Request Date
        <input
          type="date"
          value={form.requestDate}
          onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))}
          required
        />
      </label>
      <SourcePicker
        files={files}
        sourceFileId={form.sourceFileId}
        onChange={(source) => setForm((f) => ({ ...f, ...source }))}
      />
      <label style={{ gridColumn: "1 / -1" }}>
        Notes
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </label>
      {mode === "create" && (
        <>
          {hasEnabledChannel && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={form.isUrgent}
                    onChange={(e) => setForm((f) => ({ ...f, isUrgent: e.target.checked }))}
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
                    checked={form.approveNow}
                    onChange={(e) => setForm((f) => ({ ...f, approveNow: e.target.checked }))}
                  />
                  Review and approve now
                </label>
              </div>
              <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                This partner is restricted, so nothing above sends anywhere until an admin or editor reviews
                it -- normally from the Pending Dispatches page afterward. Checking this confirms, right now,
                that the text you just typed is safe to send verbatim, skipping that extra trip. You'll be
                asked to confirm the exact wording before saving.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
