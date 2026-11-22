import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  addTripContribution,
  addTripBudgetLine,
  updateTripBudgetLine,
  deleteTripBudgetLine,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import RecordList from "../components/admin/RecordList.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Field from "../components/admin/Field.jsx";

const emptyBudgetLineForm = { label: "", estimatedAmount: "" };

// Budget lines converted from onBlur-autosave onto click-row-opens-popup,
// same as AdminTripMeetings.jsx/AdminTripRequirements.jsx. Contributions
// stay a plain add-only list (no edit/delete ever existed for these, same
// shape as Trip-wide documents on the Requirements page) -- just gated.
export default function AdminTripFinancial() {
  const { trip, reload, confirmDialog, canWrite } = useOutletContext();
  const [error, setError] = useState("");
  const [newContribution, setNewContribution] = useState({
    participantId: "",
    donorName: "",
    amount: "",
    method: "check",
    receivedDate: "",
  });
  const [lineModal, setLineModal] = useState(null); // null | { id: null|lineId, form }

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function handleAddContribution(e) {
    e.preventDefault();
    if (!newContribution.donorName || !newContribution.amount || !newContribution.receivedDate) return;
    try {
      await addTripContribution(trip.id, {
        ...newContribution,
        participantId: newContribution.participantId || null,
        amount: Number(newContribution.amount),
      });
      setNewContribution({ participantId: "", donorName: "", amount: "", method: "check", receivedDate: "" });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't log this contribution.");
    }
  }

  function openAddLine() {
    setLineModal({ id: null, form: emptyBudgetLineForm });
  }

  function openEditLine(b) {
    setLineModal({ id: b.id, form: { label: b.label, estimatedAmount: String(b.estimatedAmount) } });
  }

  function setLineModalForm(updater) {
    setLineModal((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitLineModal() {
    if (!lineModal.form.label.trim()) throw new Error("Enter a line item label");
    if (lineModal.form.estimatedAmount === "") throw new Error("Enter an estimated amount");
    const patch = {
      label: lineModal.form.label.trim(),
      estimatedAmount: Number(lineModal.form.estimatedAmount),
    };
    if (lineModal.id == null) await addTripBudgetLine(trip.id, patch);
    else await updateTripBudgetLine(lineModal.id, patch);
    reload();
  }

  async function handleDeleteBudgetLine(b) {
    const confirmed = await confirmDialog({
      title: "Remove this budget line?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripBudgetLine(b.id);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this budget line.");
    }
  }

  const raised = (trip.contributions || []).reduce((sum, c) => sum + c.amount, 0);
  const budgetTotal = (trip.budgetLines || []).reduce((sum, b) => sum + b.estimatedAmount, 0);

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        <h3>Financial</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Totals for the <strong>whole team</strong>, not per person — e.g. "Round-trip flights: $650" means
          $650 for every traveler's flights combined, not $650 each.
        </p>
        <RecordList
          bare
          items={trip.budgetLines || []}
          canEdit={canWrite}
          canDelete={canWrite}
          addLabel="+ Add budget line"
          onAdd={openAddLine}
          onEdit={openEditLine}
          onDelete={handleDeleteBudgetLine}
          emptyMessage="No budget lines yet."
          renderItem={(b) => (
            <>
              <Field label="Line item" value={b.label} />
              <Field label="Estimated" value={`$${b.estimatedAmount}`} />
            </>
          )}
        />
        {(trip.budgetLines || []).length > 0 && <p style={{ fontWeight: 700, marginTop: "0.5rem" }}>Total: ${budgetTotal}</p>}
        <p style={{ marginTop: "0.6rem", fontWeight: 600 }}>
          Est. total cost: ${budgetTotal} · Raised: ${raised} · Still needed: $
          {Math.max(budgetTotal - raised, 0)}
        </p>
      </div>

      <div className="admin-section">
        <h3>Contributions ({`$${raised} raised`})</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Donor</th>
              <th>Participant</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {(trip.contributions || []).map((c) => (
              <tr key={c.id}>
                <td>{c.donorName}</td>
                <td>
                  {(trip.participants || []).find((p) => p.id === c.participantId)?.firstName || "Trip-wide"}
                </td>
                <td>${c.amount}</td>
                <td>{c.method}</td>
                <td>{formatDate(c.receivedDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canWrite && (
          <form onSubmit={handleAddContribution} className="form-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              Participant (optional)
              <select
                value={newContribution.participantId}
                onChange={(e) => setNewContribution((f) => ({ ...f, participantId: e.target.value }))}
              >
                <option value="">Trip-wide</option>
                {(trip.participants || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Donor name
              <input
                value={newContribution.donorName}
                onChange={(e) => setNewContribution((f) => ({ ...f, donorName: e.target.value }))}
              />
            </label>
            <label>
              Amount ($)
              <input
                type="number"
                value={newContribution.amount}
                onChange={(e) => setNewContribution((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label>
              Method
              <select
                value={newContribution.method}
                onChange={(e) => setNewContribution((f) => ({ ...f, method: e.target.value }))}
              >
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Received
              <input
                type="date"
                value={newContribution.receivedDate}
                onChange={(e) => setNewContribution((f) => ({ ...f, receivedDate: e.target.value }))}
              />
            </label>
            <button type="submit" className="btn secondary small" style={{ alignSelf: "end" }}>
              + Log contribution
            </button>
          </form>
        )}
      </div>

      {lineModal && canWrite && (
        <QuickActionModal
          title={lineModal.id == null ? "Add Budget Line" : "Edit Budget Line"}
          onClose={() => setLineModal(null)}
          onSubmit={submitLineModal}
        >
          <div className="form-grid">
            <label>
              Line item
              <input
                value={lineModal.form.label}
                onChange={(e) => setLineModalForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Round-trip flights, Lodging, In-country transport"
              />
            </label>
            <label>
              Estimated amount ($)
              <input
                type="number"
                value={lineModal.form.estimatedAmount}
                onChange={(e) => setLineModalForm((f) => ({ ...f, estimatedAmount: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}
    </div>
  );
}
