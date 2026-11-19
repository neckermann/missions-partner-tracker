import React from "react";

// Phase 2 of the UX-rebuild plan: the "Add Support Entry" field set
// duplicated between PartnerFinancialSection.jsx (embedded, fixed
// partnerId) and AdminMonthlySupport.jsx (consolidated, partner picked
// from a dropdown). No edit mode -- support entries have no update route
// at all (see PartnerFinancialSection.jsx's own header comment: correcting
// one means deleting it and adding another), so unlike the prayer-request/
// support-need form extractions this one has only a single shape.
// `partnerPicker`, when given, renders first -- only the consolidated
// page's form needs it.
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
