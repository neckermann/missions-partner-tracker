import React, { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  updateTrip,
  generateApplicationLink,
  reviewTripApplication,
  addTripParticipant,
  setTripRequirementComplete,
} from "../api/client.js";
import { isMinorForTrip } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import { formatDate } from "../utils/format.js";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

// Confirmed Team + the recruiting pipeline that feeds it (Applications,
// the private link, and this trip's own application questions) --
// grouped together since an application becomes a team member and the
// link/questions only exist to produce more applications.
export default function AdminTripTeam() {
  const { trip, setTrip, applications, reload, questionLibrary, confirmDialog, navigate, id } =
    useOutletContext();
  const [error, setError] = useState("");
  const [expandedApplicationId, setExpandedApplicationId] = useState(null);
  const [showDeclined, setShowDeclined] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ firstName: "", lastName: "", email: "" });

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function saveQuestions(questions) {
    try {
      const updated = await updateTrip(id, { applicationQuestions: questions });
      setTrip((t) => ({ ...t, ...updated }));
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save application questions.");
    }
  }

  async function handleGenerateLink() {
    try {
      const { applicationShareToken } = await generateApplicationLink(id);
      setTrip((t) => ({ ...t, applicationShareToken }));
      setError("");
    } catch (err) {
      reportError(
        err,
        "Couldn't generate link -- check that private application links are enabled in Trip settings."
      );
    }
  }

  async function handleReview(appId, status, declinedReason) {
    try {
      const result = await reviewTripApplication(appId, status, declinedReason);
      if (result?.participant) {
        navigate(`/admin/trips/${id}/participants/${result.participant.id}`);
        return;
      }
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't update this application.");
    }
  }

  async function handleDecline(a) {
    const result = await confirmDialog({
      title: `Decline ${a.firstName} ${a.lastName}'s application?`,
      body: (
        <ConfirmMessageBody>
          They won't be notified automatically -- the application moves to Declined below, and can still be
          reconsidered later.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Decline",
      danger: true,
      textInput: {
        label: "Reason (optional, admin-only -- never shown to the applicant)",
        placeholder: "e.g. Team is full, schedule conflict, ...",
      },
    });
    if (!result.confirmed) return;
    await handleReview(a.id, "declined", result.text);
  }

  async function handleAddParticipant(e) {
    e.preventDefault();
    if (!newParticipant.firstName) return;
    try {
      await addTripParticipant(id, newParticipant);
      setNewParticipant({ firstName: "", lastName: "", email: "" });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't add this participant.");
    }
  }

  async function handleToggleTaskComplete(requirementId, participantId, completed) {
    try {
      await setTripRequirementComplete(requirementId, participantId, completed);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't update that task.");
    }
  }

  const combinedQuestions = trip.applicationQuestions || [];
  function answersFor(application) {
    return combinedQuestions.map((q) => {
      const raw = application.responses?.[q.id];
      const answer = Array.isArray(raw) ? raw.join(", ") : raw;
      return { id: q.id, label: q.label, answer: answer || "(no answer)" };
    });
  }

  const fulfillmentFor = (participantId) =>
    (trip.requirements || []).map((req) => ({
      id: req.id,
      kind: req.kind,
      fulfilled:
        req.kind === "task"
          ? !!(req.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
          : (trip.documents || []).some(
              (d) => d.requirementId === req.id && d.participantId === participantId
            ),
    }));

  const pending = applications.filter((a) => a.status === "pending");
  const declined = applications.filter((a) => a.status === "declined");

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        <h3>Confirmed Team</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Support raising</th>
                {(trip.requirements || []).map((r) => {
                  const overdue = r.dueAt && new Date(r.dueAt) < new Date();
                  return (
                    <th key={r.id} style={{ whiteSpace: "nowrap" }}>
                      {r.label}
                      {r.minorsOnly && (
                        <div style={{ fontWeight: 400, fontSize: "0.7rem", color: "#888" }}>minors only</div>
                      )}
                      {r.dueAt && (
                        <div
                          style={{ fontWeight: 400, fontSize: "0.7rem", color: overdue ? "#b91c1c" : "#888" }}
                        >
                          due {formatDate(r.dueAt)}
                          {overdue ? " (overdue)" : ""}
                        </div>
                      )}
                    </th>
                  );
                })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(trip.participants || []).map((p) => {
                const fulfillment = fulfillmentFor(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/trips/${id}/participants/${p.id}`}>
                        {p.firstName} {p.lastName}
                      </Link>
                    </td>
                    <td>
                      $
                      {(trip.contributions || [])
                        .filter((c) => c.participantId === p.id)
                        .reduce((s, c) => s + c.amount, 0)}
                      {p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}
                    </td>
                    {(trip.requirements || []).map((r) => {
                      if (r.minorsOnly && !isMinorForTrip(p.dateOfBirth, trip.startDate)) {
                        return (
                          <td key={r.id} style={{ textAlign: "center", color: "#ccc" }} title="Minors only">
                            —
                          </td>
                        );
                      }
                      const fulfilled = !!fulfillment.find((f) => f.id === r.id)?.fulfilled;
                      return (
                        <td key={r.id} style={{ textAlign: "center" }}>
                          {r.kind === "task" ? (
                            <input
                              type="checkbox"
                              checked={fulfilled}
                              onChange={(e) => handleToggleTaskComplete(r.id, p.id, e.target.checked)}
                            />
                          ) : fulfilled ? (
                            <span style={{ color: "#1f6b4f", fontWeight: 700 }} title="On file">
                              ✓
                            </span>
                          ) : (
                            <span style={{ color: "#b91c1c", fontWeight: 700 }} title="Missing">
                              ✕
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="table-actions">
                      <Link className="btn secondary small" to={`/admin/trips/${id}/participants/${p.id}`}>
                        View details
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(trip.participants || []).length === 0 && (
                <tr>
                  <td colSpan={3 + (trip.requirements || []).length} style={{ color: "#888" }}>
                    No one confirmed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
            {pending.map((a) => {
              const expanded = expandedApplicationId === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr>
                    <td>
                      {a.firstName} {a.lastName}
                    </td>
                    <td>{formatDate(a.submittedAt)}</td>
                    <td className="table-actions">
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => setExpandedApplicationId(expanded ? null : a.id)}
                      >
                        {expanded ? "Hide answers" : "View answers"}
                      </button>
                      <button className="btn small" onClick={() => handleReview(a.id, "approved", null)}>
                        Approve
                      </button>
                      <button className="btn danger small" onClick={() => handleDecline(a)}>
                        Decline
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={3} style={{ background: "#faf9f7" }}>
                        <ApplicantAnswers application={a} answers={answersFor(a)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {pending.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "#888" }}>
                  Nothing awaiting review.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {declined.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn secondary small" onClick={() => setShowDeclined((s) => !s)}>
              {showDeclined ? "Hide" : "Show"} declined ({declined.length})
            </button>
            {showDeclined && (
              <table className="admin-table" style={{ marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Declined</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {declined.map((a) => {
                    const expanded = expandedApplicationId === a.id;
                    return (
                      <React.Fragment key={a.id}>
                        <tr>
                          <td>
                            {a.firstName} {a.lastName}
                          </td>
                          <td>{formatDate(a.reviewedAt)}</td>
                          <td style={{ color: a.declinedReason ? "#333" : "#888" }}>
                            {a.declinedReason || "(no reason given)"}
                          </td>
                          <td className="table-actions">
                            <button
                              type="button"
                              className="btn secondary small"
                              onClick={() => setExpandedApplicationId(expanded ? null : a.id)}
                            >
                              {expanded ? "Hide answers" : "View answers"}
                            </button>
                            <button
                              type="button"
                              className="btn secondary small"
                              onClick={() => handleReview(a.id, "pending", null)}
                            >
                              Reconsider
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={4} style={{ background: "#faf9f7" }}>
                              <ApplicantAnswers application={a} answers={answersFor(a)} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

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

      <div className="admin-section">
        <h3>Application questions</h3>
        <p style={{ color: "#555" }}>
          Added after the church-wide questions (Settings → Trips Settings) on both the public and private
          application forms for this trip specifically.
        </p>
        <ApplicationQuestionsEditor
          questions={trip.applicationQuestions || []}
          onAdd={(input) =>
            saveQuestions([...(trip.applicationQuestions || []), { id: crypto.randomUUID(), ...input }])
          }
          onUpdate={(qId, patch) =>
            saveQuestions(
              (trip.applicationQuestions || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
            )
          }
          onRemove={async (qId) => {
            const confirmed = await confirmDialog({
              title: "Remove this application question?",
              body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
              confirmLabel: "Remove",
              danger: true,
            });
            if (!confirmed) return;
            await saveQuestions((trip.applicationQuestions || []).filter((q) => q.id !== qId));
          }}
          onReorder={(reordered) => saveQuestions(reordered)}
          library={questionLibrary}
          onAddFromLibrary={(entry) =>
            saveQuestions([...(trip.applicationQuestions || []), { ...entry, id: crypto.randomUUID() }])
          }
        />
      </div>
    </div>
  );
}

function ApplicantAnswers({ application: a, answers }) {
  return (
    <>
      <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
        <strong>Email:</strong> {a.email || "—"}
        {a.phone && (
          <>
            {" "}
            · <strong>Phone:</strong> {a.phone}
          </>
        )}
        {(a.addressLine1 || a.city) && (
          <>
            {" "}
            · <strong>Address:</strong>{" "}
            {[a.addressLine1, a.addressLine2, a.city, a.stateProvinceRegion, a.postalCode, a.country]
              .filter(Boolean)
              .join(", ")}
          </>
        )}
        {(a.emergencyContactFirstName || a.emergencyContactPhone) && (
          <>
            {" "}
            · <strong>Emergency contact:</strong>{" "}
            {[
              [a.emergencyContactFirstName, a.emergencyContactLastName].filter(Boolean).join(" "),
              a.emergencyContactPhone,
              a.emergencyContactEmail,
            ]
              .filter(Boolean)
              .join(", ")}
          </>
        )}
      </p>
      {answers.length === 0 ? (
        <p style={{ color: "#888", fontSize: "0.85rem" }}>This trip has no application questions set.</p>
      ) : (
        <dl style={{ margin: 0 }}>
          {answers.map((q) => (
            <div key={q.id} style={{ marginBottom: "0.4rem" }}>
              <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
              <dd style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}>{q.answer}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
