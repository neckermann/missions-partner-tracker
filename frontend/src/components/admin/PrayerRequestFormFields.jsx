import React from "react";
import SourcePicker from "./SourcePicker.jsx";
import { urgentSendDescription } from "../../utils/urgentSend.js";

// The field set shared by PrayerRequestSection.jsx (fixed partnerId) and AdminPrayerRequests.jsx.
// Renders only the form-grid body; callers keep their own onSubmit and buttons.
// `mode="create"` adds the untracked/isUrgent/approveNow blocks (one-time decisions an edit
// shouldn't redo); the default "edit" omits them. `limited` is a care team member who isn't staff:
// urgent, "approve now", "Show on public profile" and "Include in printed booklet" are left out: their
// request is always held for staff review and only staff decide what is shown (the server ignores all
// four from them regardless). `partnerPicker`, when given, renders first.
export default function PrayerRequestFormFields({
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
      <label>
        Category
        <select
          value={form.category}
          onChange={(e) => {
            const category = e.target.value;
            // Everyday is staff only: nothing about it is shared, so anything that asks for sharing is cleared.
            setForm((f) =>
              category === "situational"
                ? {
                    ...f,
                    category,
                    isPublic: false,
                    includeInBooklet: false,
                    isUrgent: false,
                    approveNow: false,
                  }
                : { ...f, category }
            );
          }}
        >
          <option value="strategic">Ministry (their work and calling — can be shared publicly)</option>
          <option value="situational">Everyday (health, travel, family, paperwork — staff only)</option>
        </select>
      </label>
      {form.category === "situational" && (
        <p style={{ gridColumn: "1 / -1", margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
          Everyday requests stay with your staff. They are never posted to a chat, emailed in an update, or
          shown on the public site.
        </p>
      )}
      <label>
        Date Received
        <input
          type="date"
          value={form.dateReceived}
          onChange={(e) => setForm((f) => ({ ...f, dateReceived: e.target.value }))}
          required
        />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Prayer Request
        <textarea
          rows={2}
          value={form.requestText}
          onChange={(e) => setForm((f) => ({ ...f, requestText: e.target.value }))}
          required
        />
      </label>
      {form.category === "strategic" && !limited && (
        <div className="admin-checkbox-row" style={{ gridColumn: mode === "edit" ? "1 / -1" : undefined }}>
          <label title="Shows on this partner's public profile page, if the public site is enabled.">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  isPublic: e.target.checked,
                  includeInBooklet: e.target.checked && f.includeInBooklet,
                }))
              }
            />
            Show on public profile
          </label>
          {form.isPublic && (
            <label title="Eligible to print in the booklet -- the actual number shown per partner is capped there (see the Booklet page) so this section doesn't take over the page.">
              <input
                type="checkbox"
                checked={form.includeInBooklet}
                onChange={(e) => setForm((f) => ({ ...f, includeInBooklet: e.target.checked }))}
              />
              Include in printed booklet
            </label>
          )}
        </div>
      )}
      {mode === "create" && (
        <>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.untracked}
                onChange={(e) => setForm((f) => ({ ...f, untracked: e.target.checked }))}
              />
              Not tracking this one for a specific answer
            </label>
          </div>
          {!limited && hasEnabledChannel && form.category !== "situational" && (
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
          {!limited && canApproveNow && form.category !== "situational" && (
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
                it -- normally from the Updates to Share page afterward. Checking this confirms, right now,
                that the text you just typed is safe to send verbatim, skipping that extra trip. You'll be
                asked to confirm the exact wording before saving.
              </p>
            </div>
          )}
        </>
      )}
      <SourcePicker
        files={files}
        sourceFileId={form.sourceFileId}
        onChange={(source) => setForm((f) => ({ ...f, ...source }))}
      />
      <label style={{ gridColumn: "1 / -1" }}>
        Admin Notes (optional, never shown publicly)
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </label>
    </div>
  );
}
