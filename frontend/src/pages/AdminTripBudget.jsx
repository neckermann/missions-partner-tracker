import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addTripContribution, addTripBudgetLine, updateTripBudgetLine, deleteTripBudgetLine } from "../api/client.js";
import { formatDate } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

export default function AdminTripBudget() {
  const { trip, reload, confirmDialog } = useOutletContext();
  const [error, setError] = useState("");
  const [newBudgetLine, setNewBudgetLine] = useState({ label: "", estimatedAmount: "" });
  const [newContribution, setNewContribution] = useState({
    participantId: "",
    donorName: "",
    amount: "",
    method: "check",
    receivedDate: "",
  });

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

  async function handleAddBudgetLine(e) {
    e.preventDefault();
    if (!newBudgetLine.label.trim() || newBudgetLine.estimatedAmount === "") return;
    try {
      await addTripBudgetLine(trip.id, {
        label: newBudgetLine.label.trim(),
        estimatedAmount: Number(newBudgetLine.estimatedAmount),
      });
      setNewBudgetLine({ label: "", estimatedAmount: "" });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't add this budget line.");
    }
  }

  async function handleUpdateBudgetLine(lineId, patch) {
    try {
      await updateTripBudgetLine(lineId, patch);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save that change.");
    }
  }

  async function handleDeleteBudgetLine(lineId) {
    const confirmed = await confirmDialog({
      title: "Remove this budget line?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripBudgetLine(lineId);
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
        <h3>Budget</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Totals for the <strong>whole team</strong>, not per person — e.g. "Round-trip flights: $650" means
          $650 for every traveler's flights combined, not $650 each.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Line item</th>
              <th>Estimated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(trip.budgetLines || []).map((b) => (
              <tr key={b.id}>
                <td>
                  <input
                    defaultValue={b.label}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== b.label &&
                      handleUpdateBudgetLine(b.id, { label: e.target.value.trim() })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    defaultValue={b.estimatedAmount}
                    style={{ width: "7rem" }}
                    onBlur={(e) =>
                      e.target.value !== "" &&
                      Number(e.target.value) !== b.estimatedAmount &&
                      handleUpdateBudgetLine(b.id, { estimatedAmount: Number(e.target.value) })
                    }
                  />
                </td>
                <td className="table-actions">
                  <button type="button" className="btn-remove" onClick={() => handleDeleteBudgetLine(b.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {(trip.budgetLines || []).length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "#888" }}>
                  No budget lines yet.
                </td>
              </tr>
            )}
            {(trip.budgetLines || []).length > 0 && (
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td>${budgetTotal}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
        <form onSubmit={handleAddBudgetLine} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={newBudgetLine.label}
            onChange={(e) => setNewBudgetLine((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Round-trip flights, Lodging, In-country transport"
          />
          <input
            type="number"
            style={{ width: "7rem" }}
            value={newBudgetLine.estimatedAmount}
            onChange={(e) => setNewBudgetLine((f) => ({ ...f, estimatedAmount: e.target.value }))}
            placeholder="$"
          />
          <button type="submit" className="btn secondary small">
            + Add budget line
          </button>
        </form>
        <p style={{ marginTop: "0.6rem", fontWeight: 600 }}>
          Est. total cost: ${budgetTotal} · Raised: ${raised} · Still needed: ${Math.max(budgetTotal - raised, 0)}
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
                <td>{(trip.participants || []).find((p) => p.id === c.participantId)?.firstName || "Trip-wide"}</td>
                <td>${c.amount}</td>
                <td>{c.method}</td>
                <td>{formatDate(c.receivedDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            <input value={newContribution.donorName} onChange={(e) => setNewContribution((f) => ({ ...f, donorName: e.target.value }))} />
          </label>
          <label>
            Amount ($)
            <input type="number" value={newContribution.amount} onChange={(e) => setNewContribution((f) => ({ ...f, amount: e.target.value }))} />
          </label>
          <label>
            Method
            <select value={newContribution.method} onChange={(e) => setNewContribution((f) => ({ ...f, method: e.target.value }))}>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Received
            <input type="date" value={newContribution.receivedDate} onChange={(e) => setNewContribution((f) => ({ ...f, receivedDate: e.target.value }))} />
          </label>
          <button type="submit" className="btn secondary small" style={{ alignSelf: "end" }}>
            + Log contribution
          </button>
        </form>
      </div>
    </div>
  );
}
