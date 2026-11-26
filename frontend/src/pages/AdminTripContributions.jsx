import React, { useEffect, useMemo, useState } from "react";
import { fetchTrips, addTripContribution } from "../api/client.js";
import TripSelect from "../components/admin/TripSelect.jsx";
import { formatDate } from "../utils/format.js";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import Modal from "../components/Modal.jsx";

// Log a gift for any trip from one place, for working through a stack of checks without going into
// each trip. Same endpoint and data as a trip's own Financial tab (POST /trips/:id/contributions).
// A tab on AdminTrips.jsx; gated on the Trips feature only, not the trip budgeting sub-setting,
// since receiving a gift doesn't need a planned budget.
const emptyEntry = { donorName: "", amount: "", method: "check", receivedDate: "" };

function tripSummaryLabel(trip) {
  if (!trip) return "";
  return `${trip.partner?.displayName || "No partner linked"} — ${trip.name || trip.type || "Trip"}`;
}

export default function AdminTripContributions() {
  const { canWrite, loading: userLoading } = useCurrentUser();
  const [trips, setTrips] = useState([]);
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [entry, setEntry] = useState(emptyEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // What has been logged since this page loaded (not stored), so a person working through a stack
  // of checks can see their progress.
  const [sessionLog, setSessionLog] = useState([]);

  function reload() {
    fetchTrips().then(setTrips).catch(console.error);
  }

  useEffect(() => {
    reload();
  }, []);

  const selectedTrip = useMemo(() => trips.find((t) => t.id === tripId) || null, [trips, tripId]);

  // A team member picked on another trip means nothing on this one.
  useEffect(() => {
    setParticipantId("");
  }, [tripId]);

  // Saves one contribution. Returns true when it saved.
  async function save() {
    if (!tripId) {
      setSuccess("");
      setError("Choose a trip first.");
      return false;
    }
    if (!entry.donorName || !entry.amount || !entry.receivedDate) {
      setSuccess("");
      setError("Enter the donor, the amount and the date received.");
      return false;
    }
    setSaving(true);
    try {
      const created = await addTripContribution(tripId, {
        participantId: participantId || null,
        donorName: entry.donorName,
        amount: Number(entry.amount),
        method: entry.method,
        receivedDate: entry.receivedDate,
      });
      const participant = (selectedTrip?.participants || []).find((p) => p.id === participantId);
      setSessionLog((log) => [
        {
          id: created.id,
          tripLabel: tripSummaryLabel(selectedTrip),
          participantLabel: participant
            ? [participant.firstName, participant.lastName].filter(Boolean).join(" ")
            : "Trip-wide",
          donorName: entry.donorName,
          amount: Number(entry.amount),
          method: entry.method,
          receivedDate: entry.receivedDate,
        },
        ...log,
      ]);
      setError("");
      setSuccess(`Logged $${entry.amount} from ${entry.donorName}.`);
      reload();
      return true;
    } catch (err) {
      setSuccess("");
      setError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't log this contribution.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (await save()) {
      setOpen(false);
      setEntry(emptyEntry);
      setParticipantId("");
    }
  }

  // Keeps the trip, method and date (the next check is often for the same trip and the same day)
  // and clears only who it was from and how much.
  async function handleSaveAndAddAnother() {
    if (await save()) setEntry((f) => ({ ...f, donorName: "", amount: "" }));
  }

  function openModal() {
    setError("");
    setSuccess("");
    setOpen(true);
  }

  if (userLoading) return <p>Loading…</p>;

  if (!canWrite) {
    return <p style={{ color: "var(--muted)" }}>You don't have permission to log contributions.</p>;
  }

  const raised = (selectedTrip?.contributions || []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button type="button" className="btn" onClick={openModal}>
          + Log contribution
        </button>
      </div>

      {!open && success && (
        <p style={{ color: "var(--accent)" }} role="status">
          {success} ✓
        </p>
      )}

      {open && (
        <Modal title="Log a contribution" onClose={() => setOpen(false)}>
          <form onSubmit={handleSave}>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {success && !error && (
              <p style={{ color: "var(--accent)" }} role="status">
                {success} ✓
              </p>
            )}
            <div className="form-grid">
              <label>
                Trip
                <TripSelect trips={trips} value={tripId} onChange={setTripId} required />
              </label>
              <label>
                Team member
                <select value={participantId} onChange={(e) => setParticipantId(e.target.value)}>
                  <option value="">Trip-wide</option>
                  {(selectedTrip?.participants || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedTrip && (
              <p style={{ marginTop: "0.6rem", fontWeight: 600 }}>
                {tripSummaryLabel(selectedTrip)} — raised so far: ${raised}
              </p>
            )}
            <div className="form-grid" style={{ marginTop: "0.75rem" }}>
              <label>
                Donor name
                <input
                  value={entry.donorName}
                  onChange={(e) => setEntry((f) => ({ ...f, donorName: e.target.value }))}
                  disabled={!tripId}
                />
              </label>
              <label>
                Amount ($)
                <input
                  type="number"
                  value={entry.amount}
                  onChange={(e) => setEntry((f) => ({ ...f, amount: e.target.value }))}
                  disabled={!tripId}
                />
              </label>
              <label>
                Method
                <select
                  value={entry.method}
                  onChange={(e) => setEntry((f) => ({ ...f, method: e.target.value }))}
                  disabled={!tripId}
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
                  value={entry.receivedDate}
                  onChange={(e) => setEntry((f) => ({ ...f, receivedDate: e.target.value }))}
                  disabled={!tripId}
                />
              </label>
            </div>
            <div className="table-actions" style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn" disabled={!tripId || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={handleSaveAndAddAnother}
                disabled={!tripId || saving}
              >
                Save and add another
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="admin-section">
        <h3>Logged this session ({sessionLog.length})</h3>
        {sessionLog.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Nothing logged yet. What you save shows up here.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trip</th>
                <th>Team member</th>
                <th>Donor</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {sessionLog.map((row) => (
                <tr key={row.id}>
                  <td>{row.tripLabel}</td>
                  <td>{row.participantLabel}</td>
                  <td>{row.donorName}</td>
                  <td>${row.amount}</td>
                  <td>{row.method}</td>
                  <td>{formatDate(row.receivedDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
