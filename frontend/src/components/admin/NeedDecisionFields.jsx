import React from "react";

import { currencySymbol } from "../../utils/format.js";
// The fields of a one-time need's Record Decision form, shared by the One-Time Needs page and a partner's
// own page. "Decline" is a first-class choice: it records $0 approved (the status then reads Declined), so
// nobody has to know that typing 0 means no. `decision` is { approvedAmount, approvedDate, decisionNote },
// all strings; approvedAmount "0" is the declined state.
export default function NeedDecisionFields({ decision, setDecision, noteAsTextarea = false }) {
  const declined = decision.approvedAmount === "0";
  const set = (patch) => setDecision((d) => ({ ...d, ...patch }));

  return (
    <>
      <div className="admin-checkbox-row" style={{ marginBottom: "0.75rem" }}>
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={declined}
            onChange={(e) => set({ approvedAmount: e.target.checked ? "0" : "" })}
          />
          Decline this request (no funding)
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>
          Approved Amount ({currencySymbol()})
          <input
            type="number"
            min="0"
            value={decision.approvedAmount}
            disabled={declined}
            onChange={(e) => set({ approvedAmount: e.target.value })}
          />
        </label>
        <label>
          Decision Date
          <input
            type="date"
            value={decision.approvedDate}
            onChange={(e) => set({ approvedDate: e.target.value })}
          />
        </label>
      </div>
      <label style={{ display: "block", marginTop: "0.75rem" }}>
        Decision Note (optional)
        {noteAsTextarea ? (
          <textarea
            rows={2}
            value={decision.decisionNote}
            onChange={(e) => set({ decisionNote: e.target.value })}
            placeholder="Why this amount, or why declined. Shown in the admin notification."
          />
        ) : (
          <input value={decision.decisionNote} onChange={(e) => set({ decisionNote: e.target.value })} />
        )}
      </label>
    </>
  );
}
