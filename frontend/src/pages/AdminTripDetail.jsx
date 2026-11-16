import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchTrip,
  updateTrip,
  generateApplicationLink,
  fetchTripApplications,
  reviewTripApplication,
  addTripParticipant,
  addTripRequirement,
  updateTripRequirement,
  deleteTripRequirement,
  setTripRequirementComplete,
  addTripContribution,
  scheduleTripMeeting,
  uploadTripDocument,
  deleteTripDocument,
  fetchTripsSettings,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import TripStatusBadge from "../components/admin/TripStatusBadge.jsx";

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
  const [newRequirement, setNewRequirement] = useState({ label: "", kind: "document", dueAt: "", reminderLeadDays: "" });
  const [questionLibrary, setQuestionLibrary] = useState([]);
  const [applicationTemplate, setApplicationTemplate] = useState([]);
  const [expandedApplicationId, setExpandedApplicationId] = useState(null);
  // A declined application's row still exists (status flips, nothing is
  // deleted) but was previously never shown anywhere again -- real gap,
  // not intentional. Collapsed by default since it's a secondary,
  // look-back list, not the primary thing this section is for.
  const [showDeclined, setShowDeclined] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ firstName: "", lastName: "", email: "" });
  const [newContribution, setNewContribution] = useState({
    participantId: "",
    donorName: "",
    amount: "",
    method: "check",
    receivedDate: "",
  });
  const [meetingForm, setMeetingForm] = useState({ startAt: "", location: "" });
  // A trip-wide document (itinerary, packing list) -- participantId stays
  // null. Schema/backend already supported this (TripDocument.participantId
  // is nullable specifically for it); there was never any UI for it until
  // now.
  const [tripWideFile, setTripWideFile] = useState(null);

  const reload = useCallback(() => {
    fetchTrip(id).then(setTrip).catch(console.error);
    fetchTripApplications(id).then(setApplications).catch(console.error);
  }, [id]);

  useEffect(() => {
    // Also needed to label a submitted application's own answers (below)
    // against the full combined question list -- a response keyed by a
    // template question's id has no label at all in trip.applicationQuestions
    // alone, since that only ever holds this one trip's own questions.
    fetchTripsSettings()
      .then((s) => {
        setQuestionLibrary(s.tripQuestionLibrary || []);
        setApplicationTemplate(s.tripApplicationTemplate || []);
      })
      .catch(console.error);
  }, []);

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

  async function handleReview(appId, status, declinedReason) {
    await reviewTripApplication(appId, status, declinedReason);
    reload();
  }

  async function handleDecline(a) {
    const result = await confirmDialog({
      title: `Decline ${a.firstName} ${a.lastName}'s application?`,
      body: <ConfirmMessageBody>They won't be notified automatically -- the application moves to Declined below, and can still be reconsidered later.</ConfirmMessageBody>,
      confirmLabel: "Decline",
      danger: true,
      textInput: { label: "Reason (optional, admin-only -- never shown to the applicant)", placeholder: "e.g. Team is full, schedule conflict, ..." },
    });
    if (!result.confirmed) return;
    await handleReview(a.id, "declined", result.text);
  }

  async function handleReconsider(a) {
    await handleReview(a.id, "pending", null);
  }

  async function handleAddParticipant(e) {
    e.preventDefault();
    if (!newParticipant.firstName) return;
    await addTripParticipant(id, newParticipant);
    setNewParticipant({ firstName: "", lastName: "", email: "" });
    reload();
  }

  async function handleAddRequirement(e) {
    e.preventDefault();
    if (!newRequirement.label.trim()) return;
    await addTripRequirement(id, {
      label: newRequirement.label.trim(),
      kind: newRequirement.kind,
      dueAt: newRequirement.dueAt || null,
      reminderLeadDays: newRequirement.reminderLeadDays ? Number(newRequirement.reminderLeadDays) : null,
    });
    setNewRequirement({ label: "", kind: "document", dueAt: "", reminderLeadDays: "" });
    reload();
  }

  async function handleDeleteRequirement(reqId) {
    const confirmed = await confirmDialog({
      title: "Remove this requirement?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripRequirement(reqId);
    reload();
  }

  async function handleSetRequirementDueDate(reqId, dueAt) {
    await updateTripRequirement(reqId, { dueAt: dueAt || null });
    reload();
  }

  async function handleSetRequirementReminder(reqId, reminderLeadDays) {
    await updateTripRequirement(reqId, { reminderLeadDays: reminderLeadDays ? Number(reminderLeadDays) : null });
    reload();
  }

  async function handleToggleTaskComplete(requirementId, participantId, completed) {
    await setTripRequirementComplete(requirementId, participantId, completed);
    reload();
  }

  // Application questions -- a plain JSON array on Trip itself
  // (applicationQuestions, validated by trips.js's APPLICATION_QUESTION_SCHEMA),
  // not its own table/route, so every change here just sends the whole
  // updated array back through the same saveSetup() every other trip-level
  // field already uses. id is generated client-side (crypto.randomUUID()) --
  // it only ever needs to be unique within this one array, never looked up
  // from anywhere else.
  function saveQuestions(questions) {
    return saveSetup({ applicationQuestions: questions });
  }

  function handleAddQuestion(input) {
    const questions = [...(trip.applicationQuestions || []), { id: crypto.randomUUID(), ...input }];
    return saveQuestions(questions);
  }

  function handleAddQuestionFromLibrary(entry) {
    const questions = [...(trip.applicationQuestions || []), { ...entry, id: crypto.randomUUID() }];
    return saveQuestions(questions);
  }

  function handleUpdateQuestion(qId, patch) {
    const questions = (trip.applicationQuestions || []).map((q) => (q.id === qId ? { ...q, ...patch } : q));
    return saveQuestions(questions);
  }

  async function handleDeleteQuestion(qId) {
    const confirmed = await confirmDialog({
      title: "Remove this application question?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    const questions = (trip.applicationQuestions || []).filter((q) => q.id !== qId);
    await saveQuestions(questions);
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

  async function handleUploadTripWideDocument() {
    if (!tripWideFile) return;
    try {
      await uploadTripDocument(id, tripWideFile, {});
      setTripWideFile(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't upload this document.");
    }
  }

  function handleViewDocument(doc) {
    // Direct, same-origin, cookie-authenticated download -- the file is
    // served straight from the database, same convention as
    // AdminPartnerFiles.jsx's own handleView (backend/src/routes/trips.js's
    // new GET /documents/:id/download).
    window.open(`/api/trips/documents/${doc.id}/download`, "_blank");
  }

  async function handleDeleteDocument(docId) {
    const confirmed = await confirmDialog({
      title: "Remove this document?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripDocument(docId);
    reload();
  }

  // Same combined order the public application form itself renders --
  // template questions first, then this trip's own, so an answer keyed by
  // either layer's question id resolves to the right label here too.
  const combinedQuestions = [...applicationTemplate, ...(trip.applicationQuestions || [])];

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
      label: req.label,
      kind: req.kind,
      dueAt: req.dueAt,
      fulfilled:
        req.kind === "task"
          ? !!(req.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
          : (trip.documents || []).some((d) => d.requirementId === req.id && d.participantId === participantId),
    }));

  const raised = (trip.contributions || []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="admin-shell">
      <Link to="/admin/trips/planning">← Back to Trip Planning</Link>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{trip.name || trip.type || "Trip"}</h2>
        <TripStatusBadge status={trip.status} />
        {trip.partner?.isRestricted && (
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#a6540f", background: "#fbeee033", padding: "2px 8px", borderRadius: 999 }}>
            Restricted partner
          </span>
        )}
      </div>
      {/* Previously nowhere on this page -- an admin had no on-page
      confirmation of which partner/destination a trip belongs to at all,
      only the restricted-partner badge above touched partner data. */}
      <p style={{ margin: "0.2rem 0 0", color: "#6b6f76", fontSize: "0.85rem" }}>
        {trip.partner ? (
          <Link to={`/admin/partners/${trip.partner.id}`}>
            {trip.partner.fieldDisplayName || trip.partner.displayName}
          </Link>
        ) : (
          "No partner linked"
        )}
      </p>
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
        {/* Previously nowhere -- the field was read and shown on the
        participant self-service page, but there was no UI anywhere to
        ever set it. Entered once after group travel is booked, so it's
        usually empty well after the roster is finalized -- normal, not a
        bug (see §9's own decision on why there's no separate notification
        for it either). */}
        <label style={{ marginTop: "0.75rem" }}>
          Flight details (shown only on each participant's own self-service page, never publicly)
          <textarea
            rows={2}
            defaultValue={trip.flightDetails || ""}
            onBlur={(e) => saveSetup({ flightDetails: e.target.value })}
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

      {/* Application questions */}
      <div className="admin-section">
        <h3>Application questions</h3>
        <p style={{ color: "#555" }}>
          Added after the church-wide questions (Site Administration → Trips Settings) on both the public and
          private application forms for this trip specifically.
        </p>
        <ApplicationQuestionsEditor
          questions={trip.applicationQuestions || []}
          onAdd={handleAddQuestion}
          onUpdate={handleUpdateQuestion}
          onRemove={handleDeleteQuestion}
          library={questionLibrary}
          onAddFromLibrary={handleAddQuestionFromLibrary}
        />
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
              .map((a) => {
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
                          <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
                            <strong>Email:</strong> {a.email || "—"}
                            {a.phone && (
                              <>
                                {" "}· <strong>Phone:</strong> {a.phone}
                              </>
                            )}
                          </p>
                          {answersFor(a).length === 0 ? (
                            <p style={{ color: "#888", fontSize: "0.85rem" }}>This trip has no application questions set.</p>
                          ) : (
                            <dl style={{ margin: 0 }}>
                              {answersFor(a).map((q) => (
                                <div key={q.id} style={{ marginBottom: "0.4rem" }}>
                                  <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
                                  <dd style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}>{q.answer}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            {applications.filter((a) => a.status === "pending").length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "#888" }}>
                  Nothing awaiting review.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Previously a real gap: a declined row still exists (nothing
        deletes it), but was never shown anywhere again once it left the
        pending table above -- no way to recall why, or to reconsider it.
        Collapsed by default since it's a look-back list, not the primary
        thing this section is for. */}
        {applications.filter((a) => a.status === "declined").length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn secondary small" onClick={() => setShowDeclined((s) => !s)}>
              {showDeclined ? "Hide" : "Show"} declined ({applications.filter((a) => a.status === "declined").length})
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
                  {applications
                    .filter((a) => a.status === "declined")
                    .map((a) => {
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
                              <button type="button" className="btn secondary small" onClick={() => handleReconsider(a)}>
                                Reconsider
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={4} style={{ background: "#faf9f7" }}>
                                <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
                                  <strong>Email:</strong> {a.email || "—"}
                                  {a.phone && (
                                    <>
                                      {" "}· <strong>Phone:</strong> {a.phone}
                                    </>
                                  )}
                                </p>
                                {answersFor(a).length === 0 ? (
                                  <p style={{ color: "#888", fontSize: "0.85rem" }}>This trip has no application questions set.</p>
                                ) : (
                                  <dl style={{ margin: 0 }}>
                                    {answersFor(a).map((q) => (
                                      <div key={q.id} style={{ marginBottom: "0.4rem" }}>
                                        <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
                                        <dd style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}>{q.answer}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
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

      {/* Roster -- simplified (#252 follow-on). Per-participant document
      upload/request, access-link controls, and task checkboxes all used
      to live crammed into this table's action column; moved to each
      participant's own detail page (linked below) and the Requirements
      overview matrix section, since a requirement x participant
      relationship doesn't actually fit one flat roster row. This table
      is now just "who's on the team." */}
      <div className="admin-section">
        <h3>Roster</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Support raising</th>
              <th>Still needed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(trip.participants || []).map((p) => {
              const missing = fulfillmentFor(p.id).filter((f) => !f.fulfilled);
              return (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/trips/${id}/participants/${p.id}`}>
                      {p.firstName} {p.lastName}
                    </Link>
                  </td>
                  <td>
                    ${(trip.contributions || []).filter((c) => c.participantId === p.id).reduce((s, c) => s + c.amount, 0)}
                    {p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}
                  </td>
                  <td>{missing.length === 0 ? "—" : `${missing.length} item${missing.length === 1 ? "" : "s"}`}</td>
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
                <td colSpan={4} style={{ color: "#888" }}>
                  No one on the roster yet.
                </td>
              </tr>
            )}
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

      {/* Trip-wide documents (itinerary, packing list, etc.) --
      participantId: null, distinct from the per-participant documents
      logged on each roster row above. Schema already supported this;
      there was no UI for it until now. */}
      <div className="admin-section">
        <h3>Trip-wide documents</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Shared with the whole team -- an itinerary, packing list, or anything else that isn't specific to one
          person.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {(trip.documents || [])
            .filter((d) => !d.participantId)
            .map((d) => (
              <li key={d.id} style={{ marginBottom: "0.3rem" }}>
                {d.title || d.fileName}{" "}
                <button type="button" className="btn secondary small" onClick={() => handleViewDocument(d)}>
                  View
                </button>{" "}
                <button type="button" className="btn-remove" onClick={() => handleDeleteDocument(d.id)}>
                  ✕
                </button>
              </li>
            ))}
          {(trip.documents || []).filter((d) => !d.participantId).length === 0 && (
            <p style={{ color: "#888" }}>No trip-wide documents yet.</p>
          )}
        </ul>
        <input type="file" aria-label="Trip-wide document file" onChange={(e) => setTripWideFile(e.target.files[0] || null)} />
        <button type="button" className="btn secondary small" disabled={!tripWideFile} onClick={handleUploadTripWideDocument}>
          Upload
        </button>
      </div>

      {/* Requirements -- a document or a plain task (#252 generalization),
      each optionally with its own due date and a reminder lead time.
      Placed after the roster, not before (its natural reading order --
      you're tracking fulfillment against a confirmed team, which doesn't
      exist until the section above this one). */}
      <div className="admin-section">
        <h3>Requirements</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          What this trip needs from each participant -- a document to upload, or a plain task an admin checks off
          (e.g. "Attended orientation call"). Give one a due date to see it flagged once overdue; add a reminder
          lead time to have anyone who hasn't fulfilled it emailed automatically before it's due.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {(trip.requirements || []).map((r) => {
            const overdue = r.dueAt && new Date(r.dueAt) < new Date();
            return (
              <li key={r.id} style={{ border: "1px solid #e1dfdb", borderRadius: 6, padding: "0.5rem 0.6rem", marginBottom: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: r.kind === "task" ? "#2a5d8f" : "#1f6b4f",
                      background: r.kind === "task" ? "#e8eff7" : "#e7f3ee",
                    }}
                  >
                    {r.kind === "task" ? "Task" : "Document"}
                  </span>
                  <strong style={{ flex: 1 }}>{r.label}</strong>
                  <label style={{ fontWeight: 400, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    Due
                    <input
                      type="date"
                      defaultValue={r.dueAt ? r.dueAt.slice(0, 10) : ""}
                      onBlur={(e) => handleSetRequirementDueDate(r.id, e.target.value)}
                      style={{ width: "9.5rem" }}
                    />
                  </label>
                  {r.dueAt && (
                    <label style={{ fontWeight: 400, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      Remind
                      <input
                        type="number"
                        min="1"
                        placeholder="days before"
                        defaultValue={r.reminderLeadDays || ""}
                        onBlur={(e) => handleSetRequirementReminder(r.id, e.target.value)}
                        style={{ width: "6rem" }}
                      />
                    </label>
                  )}
                  {overdue && (
                    <span style={{ color: "#b91c1c", fontSize: "0.75rem", fontWeight: 600 }}>Overdue</span>
                  )}
                  <button type="button" className="btn-remove" onClick={() => handleDeleteRequirement(r.id)}>
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
          {(trip.requirements || []).length === 0 && <p style={{ color: "#888" }}>No requirements yet.</p>}
        </ul>
        <form onSubmit={handleAddRequirement} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={newRequirement.label}
            onChange={(e) => setNewRequirement((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Signed Waiver, or Attended orientation call"
          />
          <select
            value={newRequirement.kind}
            onChange={(e) => setNewRequirement((f) => ({ ...f, kind: e.target.value }))}
          >
            <option value="document">Document</option>
            <option value="task">Task</option>
          </select>
          <label style={{ fontWeight: 400, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            Due (optional)
            <input
              type="date"
              value={newRequirement.dueAt}
              onChange={(e) => setNewRequirement((f) => ({ ...f, dueAt: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn secondary small">
            + Add
          </button>
        </form>
      </div>

      {/* Requirements overview -- a matrix (requirement x participant), not
      flattened into the roster or the requirement-definition list above.
      Matches the data's actual shape: a requirement is defined once per
      trip, but its fulfillment is per participant. Uploading a document
      now happens on that participant's own detail page (linked from the
      Roster); a task can still be toggled directly here since that's a
      trivial one-click action worth keeping inline rather than a trip to
      another page. */}
      <div className="admin-section">
        <h3>Requirements overview</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          What's still outstanding across the whole team. Upload a document from a participant's own detail page;
          check off a task directly here.
        </p>
        {(trip.requirements || []).length === 0 ? (
          <p style={{ color: "#888" }}>No requirements defined yet -- add one above.</p>
        ) : (trip.participants || []).length === 0 ? (
          <p style={{ color: "#888" }}>No participants on the roster yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  {trip.participants.map((p) => (
                    <th key={p.id}>
                      {p.firstName} {p.lastName ? `${p.lastName.charAt(0)}.` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trip.requirements.map((r) => {
                  const overdue = r.dueAt && new Date(r.dueAt) < new Date();
                  return (
                    <tr key={r.id}>
                      <td>
                        {r.label}
                        {r.dueAt && (
                          <div style={{ fontSize: "0.7rem", color: overdue ? "#b91c1c" : "#888" }}>
                            due {formatDate(r.dueAt)}
                            {overdue ? " (overdue)" : ""}
                          </div>
                        )}
                      </td>
                      {trip.participants.map((p) => {
                        const fulfilled = !!fulfillmentFor(p.id).find((f) => f.id === r.id)?.fulfilled;
                        return (
                          <td key={p.id} style={{ textAlign: "center" }}>
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
                              <span style={{ color: "#b91c1c" }} title="Missing">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
