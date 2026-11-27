import React from "react";
import SourcePicker from "./SourcePicker.jsx";
import { urgentSendDescription } from "../../utils/urgentSend.js";

import { currencySymbol } from "../../utils/format.js";
// The one-time-need field set shared by PartnerFinancialSection.jsx (fixed partnerId, add and
// decide only) and AdminOneTimeNeeds.jsx. Like PrayerRequestFormFields.jsx: form-grid body only,
// `mode` controls the create-only isUrgent/approveNow blocks, `partnerPicker` is injected when
// given. `limited` is a care team member who isn't staff: urgent and "approve now" are left out
// because their dispatch is always held for staff review. The decision on a need isn't in this
// form; it is staff's, via Record Decision.
export default function SupportNeedFormFields({
  form,
  setForm,
  files,
  mode = "edit",
  hasEnabledChannel,
  canApproveNow,
  enabledFeatures,
  partnerPicker,
  limited = false,
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
        Requested Amount ({currencySymbol()}, optional)
        <input
          type="number"
          min="0"
          value={form.requestedAmount}
          placeholder="Leave blank if no amount was named"
          onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))}
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
      {mode === "edit" && (
        <>
          <label>
            Someone's on it (who, optional)
            <input
              value={form.handledBy ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, handledBy: e.target.value }))}
              placeholder="A person or a group, e.g. the deacons"
              maxLength={120}
            />
          </label>
          <label>
            Met on (optional)
            <input
              type="date"
              value={form.metDate ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, metDate: e.target.value }))}
            />
          </label>
        </>
      )}
      {mode === "create" && !limited && (
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
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
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
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                This partner is restricted, so nothing above sends anywhere until an admin or editor reviews
                it -- normally from the Updates to share page afterward. Checking this confirms, right now,
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
