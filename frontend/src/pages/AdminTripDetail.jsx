import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchTrip,
  updateTrip,
  generateApplicationLink,
  fetchTripApplications,
  reviewTripApplication,
  addTripParticipant,
  generateSupportRaisingLink,
  resendParticipantAccessLink,
  addTripDocumentRequirement,
  deleteTripDocumentRequirement,
  requestTripDocuments,
  addTripContribution,
  scheduleTripMeeting,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// New (#252) -- the fuller single-trip page for an actively-recruited
// trip (applications/roster/meetings/documents/support raising). A purely
// historical backfill never reaches this page -- it's managed inline on
// AdminTrips.jsx/the partner's own page, exactly as before this feature
// existed.
export default function AdminTripDetail() {
  const { id } = useParams();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [trip, setTrip] = useState(null);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [savingSetup, setSavingSetup] = useState(false);
  const [newRequirement, setNewRequirement] = useState("");
  const [newParticipant, setNewParticipant] = useState({ firstName: "", lastName: "", email: "" });
  const [newContribution, setNewContribution] = useState({
    participantId: "",
    donorName: "",
    amount: "",
    method: "check",
    receivedDate: "",
  });
  const [meetingForm, setMeetingForm] = useState({ startAt: "", location: "" });
  const [docMessage, setDocMessage] = useState({});

  const reload = useCallback(() => {
    fetchTrip(id).then(setTrip).catch(console.error);
    fetchTripApplications(id).then(setApplications).catch(console.error);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!trip) return <div className="admin-shell">Loading…</div>;

  async function saveSetup(fields) {
    setSavingSetup(true);
    setError("");
    try {
      const updated = await updateTrip(id, fields);
      setTrip((t) => ({ ...t, ...updated }));
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save");
    } finally {
      setSavingSetup(false);
    }
  }

  async function handleGenerateLink() {
    try {
      const { applicationShareToken } = await generateApplicationLink(id);
      setTrip((t) => ({ ...t, applicationShareToken }));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't generate link -- check that private application links are enabled in Trip settings.");
    }
  }

  async function handleReview(appId, status) {
    await reviewTripApplication(appId, status);
    reload();
  }

  async function handleAddParticipant(e) {
    e.preventDefault();
    if (!newParticipant.firstName) return;
    await addTripParticipant(id, newParticipant);
    setNewParticipant({ firstName: "", lastName: "", email: "" });
    reload();
  }

  async function handleGenerateSupportRaisingLink(participantId) {
    try {
      await generateSupportRaisingLink(participantId);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't generate link -- check that public support-raising links are enabled in Trip settings.");
    }
  }

  async function handleAddRequirement(e) {
    e.preventDefault();
    if (!newRequirement.trim()) return;
    await addTripDocumentRequirement(id, newRequirement.trim());
    setNewRequirement("");
    reload();
  }

  async function handleDeleteRequirement(reqId) {
    const confirmed = await confirmDialog({
      title: "Remove this document requirement?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripDocumentRequirement(reqId);
    reload();
  }

  async function handleAddContribution(e) {
    e.preventDefault();
    if (!newContribution.donorName || !newContribution.amount || !newContribution.receivedDate) return;
    await addTripContribution(id, {
      ...newContribution,
      participantId: newContribution.participantId || null,
      amount: Number(newContribution.amount),
    });
    setNewContribution({ participantId: "", donorName: "", amount: "", method: "check", receivedDate: "" });
    reload();
  }

  async function handleScheduleMeeting(e) {
    e.preventDefault();
    if (!meetingForm.startAt) return;
    await scheduleTripMeeting(id, meetingForm);
    setMeetingForm({ startAt: "", location: "" });
    reload();
  }

  async function handleRequestDocuments(participantId) {
    const message = docMessage[participantId];
    if (!message) return;
    try {
      await requestTripDocuments(id, participantId, message);
      setDocMessage((m) => ({ ...m, [participantId]: "" }));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send -- check that outbound and inbound email are configured.");
    }
  }

  const fulfillmentFor = (participantId) =>
    (trip.documentRequirements || []).map((req) => ({
      label: req.label,
      fulfilled: (trip.documents || []).some((d) => d.requirementId === req.id && d.participantId === participantId),
    }));

  const raised = (trip.contributions || []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="admin-shell">
      <Link to="/admin/trips/planning">← Back to Trip Planning</Link>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{trip.name || trip.type || "Trip"}</h2>
        <span style={{ fontSize: "0.8rem", color: "#2a5d8f", fontWeight: 700 }}>{trip.status}</span>
        {trip.partner?.isRestricted && (
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#a6540f", background: "#fbeee033", padding: "2px 8px", borderRadius: 999 }}>
            Restricted partner
          </span>
        )}
      </div>
      {error && (
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      )}

      {/* Trip setup */}
      <div className="admin-section">
        <h3>Trip setup</h3>
        <div className="form-grid">
          <label>
            Trip name
            <input
              defaultValue={trip.name || ""}
              onBlur={(e) => e.target.value !== (trip.name || "") && saveSetup({ name: e.target.value })}
            />
          </label>
          <label>
            Status
            <select value={trip.status} onChange={(e) => saveSetup({ status: e.target.value })}>
              <option value="planning">Planning</option>
              <option value="accepting_applications">Accepting applications</option>
              <option value="closed">Closed</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            Start Date
            <input
              type="date"
              defaultValue={trip.startDate?.slice(0, 10) || ""}
              onBlur={(e) => saveSetup({ startDate: e.target.value || null })}
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              defaultValue={trip.endDate?.slice(0, 10) || ""}
              onBlur={(e) => saveSetup({ endDate: e.target.value || null })}
            />
          </label>
          <label>
            Team size min / max
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="number"
                defaultValue={trip.teamSizeMin || ""}
                onBlur={(e) => saveSetup({ teamSizeMin: e.target.value ? Number(e.target.value) : null })}
              />
              <input
                type="number"
                defaultValue={trip.teamSizeMax || ""}
                onBlur={(e) => saveSetup({ teamSizeMax: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </label>
          <label>
            Support-raising goal (per person, $)
            <input
              type="number"
              defaultValue={trip.supportRaisingGoal || ""}
              onBlur={(e) => saveSetup({ supportRaisingGoal: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
        </div>
        <label style={{ marginTop: "0.75rem" }}>
          Description
          <textarea
            rows={2}
            defaultValue={trip.description || ""}
            onBlur={(e) => saveSetup({ description: e.target.value })}
          />
        </label>
        {trip.partner?.isRestricted && (
          <div
            style={{
              background: "#fbeee0",
              border: "1px solid #e3b183",
              borderRadius: 8,
              padding: "0.6rem 0.9rem",
              fontSize: "0.8rem",
              color: "#7a3e0c",
              marginTop: "0.5rem",
            }}
          >
            <strong>This trip is linked to a restricted partner.</strong> The name and description above may
            still appear on a masked public link. Avoid naming the actual location here.
          </div>
        )}
        <div className="admin-checkbox-row" style={{ marginTop: "0.75rem" }}>
          <label>
            <input
              type="checkbox"
              checked={!!trip.isPublic}
              onChange={(e) => saveSetup({ isPublic: e.target.checked })}
            />
            Visible on public discovery page
          </label>
        </div>
        {trip.partner?.isRestricted && (
          <p style={{ fontSize: "0.75rem", color: "#a6540f" }}>
            Has no public-facing effect for this trip while the restricted-partner badge is showing.
          </p>
        )}
        {savingSetup && <p style={{ color: "#888" }}>Saving…</p>}
      </div>

      {/* Private link */}
      <div className="admin-section">
        <h3>Private application link</h3>
        <p style={{ color: "#555" }}>
          Share this directly with specific people — never listed, never publicly discoverable. Works even for
          a restricted partner (masked).
        </p>
        {trip.applicationShareToken ? (
          <p>
            <code>{`${window.location.origin}/apply/by-token/${trip.applicationShareToken}`}</code>
          </p>
        ) : (
          <p style={{ color: "#888" }}>No link generated yet.</p>
        )}
        <button type="button" className="btn secondary small" onClick={handleGenerateLink}>
          {trip.applicationShareToken ? "Regenerate link" : "Generate private application link"}
        </button>
      </div>

      {/* Document requirements */}
      <div className="admin-section">
        <h3>Document requirements</h3>
        <ul>
          {(trip.documentRequirements || []).map((r) => (
            <li key={r.id}>
              {r.label}{" "}
              <button type="button" className="btn-remove" onClick={() => handleDeleteRequirement(r.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddRequirement} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={newRequirement}
            onChange={(e) => setNewRequirement(e.target.value)}
            placeholder="e.g. Signed Waiver"
          />
          <button type="submit" className="btn secondary small">
            + Add
          </button>
        </form>
      </div>

      {/* Meetings */}
      <div className="admin-section">
        <h3>Meetings</h3>
        <ul>
          {(trip.meetings || []).map((m) => (
            <li key={m.id}>
              {formatDate(m.startAt)} {m.location ? `— ${m.location}` : ""}
            </li>
          ))}
        </ul>
        <form onSubmit={handleScheduleMeeting} className="form-grid">
          <label>
            Date/time
            <input
              type="datetime-local"
              value={meetingForm.startAt}
              onChange={(e) => setMeetingForm((f) => ({ ...f, startAt: e.target.value }))}
            />
          </label>
          <label>
            Location
            <input
              value={meetingForm.location}
              onChange={(e) => setMeetingForm((f) => ({ ...f, location: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn secondary small" style={{ alignSelf: "end" }}>
            Schedule meeting
          </button>
        </form>
      </div>

      {/* Applications */}
      <div className="admin-section">
        <h3>Applications awaiting review</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {applications
              .filter((a) => a.status === "pending")
              .map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.firstName} {a.lastName}
                  </td>
                  <td>{formatDate(a.submittedAt)}</td>
                  <td className="table-actions">
                    <button className="btn small" onClick={() => handleReview(a.id, "approved")}>
                      Approve
                    </button>
                    <button className="btn danger small" onClick={() => handleReview(a.id, "declined")}>
                      Decline
                    </button>
                  </td>
                </tr>
              ))}
            {applications.filter((a) => a.status === "pending").length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "#888" }}>
                  Nothing awaiting review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Roster */}
      <div className="admin-section">
        <h3>Roster</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Support raising</th>
              <th>Missing documents</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(trip.participants || []).map((p) => {
              const missing = fulfillmentFor(p.id).filter((f) => !f.fulfilled);
              return (
                <tr key={p.id}>
                  <td>
                    {p.firstName} {p.lastName}
                  </td>
                  <td>
                    ${(trip.contributions || []).filter((c) => c.participantId === p.id).reduce((s, c) => s + c.amount, 0)}
                    {p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}
                    {p.shareToken ? (
                      <div style={{ fontSize: "0.7rem" }}>
                        <code>{`${window.location.origin}/trip-support-raising/${p.shareToken}`}</code>
                      </div>
                    ) : null}
                  </td>
                  <td>{missing.length ? missing.map((m) => m.label).join(", ") : "—"}</td>
                  <td className="table-actions">
                    {!p.shareToken && (
                      <button className="btn secondary small" onClick={() => handleGenerateSupportRaisingLink(p.id)}>
                        Generate support-raising link
                      </button>
                    )}
                    <button className="btn secondary small" onClick={() => resendParticipantAccessLink(p.id)}>
                      Resend access link
                    </button>
                    <input
                      style={{ width: 160 }}
                      placeholder="Document request message"
                      value={docMessage[p.id] || ""}
                      onChange={(e) => setDocMessage((m) => ({ ...m, [p.id]: e.target.value }))}
                    />
                    <button className="btn secondary small" onClick={() => handleRequestDocuments(p.id)}>
                      Request documents
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form onSubmit={handleAddParticipant} className="form-grid" style={{ marginTop: "0.75rem" }}>
          <label>
            First name
            <input
              value={newParticipant.firstName}
              onChange={(e) => setNewParticipant((f) => ({ ...f, firstName: e.target.value }))}
            />
          </label>
          <label>
            Last name
            <input
              value={newParticipant.lastName}
              onChange={(e) => setNewParticipant((f) => ({ ...f, lastName: e.target.value }))}
            />
          </label>
          <label>
            Email
            <input
              value={newParticipant.email}
              onChange={(e) => setNewParticipant((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn secondary small" style={{ alignSelf: "end" }}>
            + Add participant directly
          </button>
        </form>
      </div>

      {/* Contributions */}
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
      </div>
      {confirmElement}
    </div>
  );
}
