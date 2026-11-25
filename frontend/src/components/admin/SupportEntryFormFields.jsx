import React from "react";

// The "Add Support Entry" field set shared by PartnerFinancialSection.jsx and
// AdminMonthlySupport.jsx. No edit mode: support entries have no update route (correct one by
// deleting and re-adding). `partnerPicker`, when given, renders first.
export default function SupportEntryFormFields({ form, setForm, partnerPicker }) {
  return (
    <div className="form-grid">
      {partnerPicker}
      <label>
        Monthly Amount (USD)
        <input
          type="number"
          min="0"
          step="1"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          required
        />
      </label>
      <label>
        Effective Date
        <input
          type="date"
          value={form.effectiveDate}
          onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
          required
        />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Notes
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </label>
    </div>
  );
}
