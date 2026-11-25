import React, { useEffect, useMemo, useState } from "react";
import { fetchTrips, addTripContribution } from "../api/client.js";
import TripSelect from "../components/admin/TripSelect.jsx";
import { formatDate } from "../utils/format.js";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// #272: logging a contribution used to only be possible from inside one
// trip's own Financial tab (AdminTripFinancial.jsx), one trip at a time --
// no single place for a church secretary holding a stack of checks for
// several different trips/team members to work through them without
// re-navigating per trip. Same backend endpoint
// (POST /trips/:id/contributions) and data shape as that page's own
// form, just reachable with a Trip selector up front instead of already
// being on that trip's page -- no schema/route change needed.
//
// Rendered as a tab on AdminTrips.jsx (route "trips/contributions"), not
// its own page -- the parent supplies the "Trips" shell/heading and the
// RequireAdminFeature("trips") gate. Gated on the Trips feature only, NOT
// enableTripBudgeting: that sub-setting governs the per-trip Financial
// tab's *budget-line* tracking (estimated costs vs. raised), a genuinely
// separate thing from "a gift came in, log it" -- you can receive and
// record a contribution without ever having set a planned budget.
const emptyEntry = { donorName: "", amount: "", method: "check", receivedDate: "" };

function tripSummaryLabel(trip) {
  if (!trip) return "";
  return `${trip.partner?.displayName || "No partner linked"} — ${trip.name || trip.type || "Trip"}`;
}

export default function AdminTripContributions() {
  const { canWrite, loading: userLoading } = useCurrentUser();
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [entry, setEntry] = useState(emptyEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Session-only -- not persisted anywhere, just a running list of what's
  // been logged on this page since it loaded, so the person working
  // through a stack of checks can see their own progress without leaving
  // the page (the whole point of this page over the per-trip form).
  const [sessionLog, setSessionLog] = useState([]);

  function reload() {
    fetchTrips().then(setTrips).catch(console.error);
  }

  useEffect(() => {
    reload();
  }, []);

  const selectedTrip = useMemo(() => trips.find((t) => t.id === tripId) || null, [trips, tripId]);

  // A participant picked on a previous trip means nothing once the trip
  // itself changes -- clear it rather than silently keep a stale id that
  // doesn't belong to the newly-selected trip's own roster.
  useEffect(() => {
    setParticipantId("");
  }, [tripId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!tripId) {
      setSuccess("");
      setError("Choose a trip first.");
      return;
    }
    if (!entry.donorName || !entry.amount || !entry.receivedDate) return;
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
      // Trip selector stays sticky -- the next check in the stack is
      // often for the same trip. Team member resets to "Trip-wide" and
      // the entry fields clear, so the form is immediately ready for the
      // next one without re-selecting the trip.
      setParticipantId("");
      setEntry(emptyEntry);
      reload();
    } catch (err) {
      setSuccess("");
      setError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't log this contribution.");
    } finally {
      setSaving(false);
    }
  }

  if (userLoading) return <p>Loading…</p>;

  if (!canWrite) {
    return <p style={{ color: "var(--muted)" }}>You don't have permission to log contributions.</p>;
  }

  const raised = (selectedTrip?.contributions || []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <div>
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

      <div className="admin-section">
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

        <form onSubmit={handleSubmit} className="form-grid" style={{ marginTop: "0.75rem" }}>
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
          <button type="submit" className="btn" style={{ alignSelf: "end" }} disabled={!tripId || saving}>
            {saving ? "Logging…" : "+ Log contribution"}
          </button>
        </form>
      </div>

      <div className="admin-section">
        <h3>Logged this session ({sessionLog.length})</h3>
        {sessionLog.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Nothing logged yet -- what you save above shows up here.</p>
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
