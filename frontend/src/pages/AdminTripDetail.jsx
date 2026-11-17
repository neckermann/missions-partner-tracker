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
  addTripBudgetLine,
  updateTripBudgetLine,
  deleteTripBudgetLine,
  addTripFlightSegment,
  updateTripFlightSegment,
  deleteTripFlightSegment,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import TripStatusBadge from "../components/admin/TripStatusBadge.jsx";

// New (#252) -- the fuller single-trip page for an actively-recruited
// trip (applications/team/meetings/documents/support raising). A purely
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
  const [newRequirement, setNewRequirement] = useState({
    label: "",
    kind: "document",
    bodyText: "",
    dueAt: "",
    reminderLeadDays: "",
  });
  const [questionLibrary, setQuestionLibrary] = useState([]);
  const [applicationTemplate, setApplicationTemplate] = useState([]);
  // Church-wide toggle (AdminSettingsTrips.jsx) -- the Budget section
  // below doesn't render at all unless this is on, same as every other
  // toggle-gated capability in this feature area.
  const [enableTripBudgeting, setEnableTripBudgeting] = useState(false);
  const [newBudgetLine, setNewBudgetLine] = useState({ label: "", estimatedAmount: "" });
  const [newFlightSegment, setNewFlightSegment] = useState({
    label: "",
    airline: "",
    flightNumber: "",
    departureAirport: "",
    departureAt: "",
    arrivalAirport: "",
    arrivalAt: "",
  });
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
        setEnableTripBudgeting(!!s.enableTripBudgeting);
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
      setError(
        err.response?.data?.error ||
          "Couldn't generate link -- check that private application links are enabled in Trip settings."
      );
    }
  }

  async function handleReview(appId, status, declinedReason) {
    await reviewTripApplication(appId, status, declinedReason);
    reload();
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
      bodyText: newRequirement.kind === "esignature" ? newRequirement.bodyText.trim() || null : null,
      dueAt: newRequirement.dueAt || null,
      reminderLeadDays: newRequirement.reminderLeadDays ? Number(newRequirement.reminderLeadDays) : null,
    });
    setNewRequirement({ label: "", kind: "document", bodyText: "", dueAt: "", reminderLeadDays: "" });
    reload();
  }

  async function handleSetRequirementBodyText(reqId, bodyText) {
    await updateTripRequirement(reqId, { bodyText: bodyText || null });
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
    await updateTripRequirement(reqId, {
      reminderLeadDays: reminderLeadDays ? Number(reminderLeadDays) : null,
    });
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

  function handleReorderQuestions(reordered) {
    return saveQuestions(reordered);
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

  async function handleAddBudgetLine(e) {
    e.preventDefault();
    if (!newBudgetLine.label.trim() || newBudgetLine.estimatedAmount === "") return;
    await addTripBudgetLine(id, {
      label: newBudgetLine.label.trim(),
      estimatedAmount: Number(newBudgetLine.estimatedAmount),
    });
    setNewBudgetLine({ label: "", estimatedAmount: "" });
    reload();
  }

  async function handleUpdateBudgetLine(lineId, patch) {
    await updateTripBudgetLine(lineId, patch);
    reload();
  }

  async function handleDeleteBudgetLine(lineId) {
    const confirmed = await confirmDialog({
      title: "Remove this budget line?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripBudgetLine(lineId);
    reload();
  }

  async function handleAddFlightSegment(e) {
    e.preventDefault();
    await addTripFlightSegment(id, {
      label: newFlightSegment.label.trim() || null,
      airline: newFlightSegment.airline.trim() || null,
      flightNumber: newFlightSegment.flightNumber.trim() || null,
      departureAirport: newFlightSegment.departureAirport.trim() || null,
      departureAt: newFlightSegment.departureAt || null,
      arrivalAirport: newFlightSegment.arrivalAirport.trim() || null,
      arrivalAt: newFlightSegment.arrivalAt || null,
    });
    setNewFlightSegment({
      label: "",
      airline: "",
      flightNumber: "",
      departureAirport: "",
      departureAt: "",
      arrivalAirport: "",
      arrivalAt: "",
    });
    reload();
  }

  async function handleUpdateFlightSegment(segmentId, patch) {
    await updateTripFlightSegment(segmentId, patch);
    reload();
  }

  async function handleDeleteFlightSegment(segmentId) {
    const confirmed = await confirmDialog({
      title: "Remove this flight segment?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripFlightSegment(segmentId);
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
          : (trip.documents || []).some(
              (d) => d.requirementId === req.id && d.participantId === participantId
            ),
    }));

  const raised = (trip.contributions || []).reduce((sum, c) => sum + c.amount, 0);
  const budgetTotal = (trip.budgetLines || []).reduce((sum, b) => sum + b.estimatedAmount, 0);

  return (
    <div className="admin-shell">
      <Link to="/admin/trips/planning">← Back to Trip Planning</Link>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{trip.name || trip.type || "Trip"}</h2>
        <TripStatusBadge status={trip.status} />
        {trip.partner?.isRestricted && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#a6540f",
              background: "#fbeee033",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
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
              onBlur={(e) =>
                saveSetup({ supportRaisingGoal: e.target.value ? Number(e.target.value) : null })
              }
            />
            {/* Suggests a per-person goal at the point you'd actually set
            one, instead of guessing blind. A single number, not a
            min-max range -- the goal field itself only ever holds one
            value, and a range just pushes the same "which number do I
            actually type" decision onto the admin instead of answering
            it. Assumes the full recruiting target (teamSizeMax) is the
            planning number, the same way a real trip leader would
            reason: "we're recruiting for 10, here's the cost, so that's
            the ask per person if we fill the team" -- a smaller actual
            team becomes a budget shortfall to solve later, not something
            that retroactively raises what everyone already agreed to
            raise. Suggestion only, never forced -- the field stays a
            plain number the admin can always override. Nested inside
            this label (not a sibling after the whole grid row) so it
            reads as being about this one field, not the row in general --
            a real screenshot showed it floating ambiguously under all
            three fields when it sat outside the grid. */}
            {enableTripBudgeting && budgetTotal > 0 && (trip.teamSizeMax || trip.teamSizeMin) && (
              <span
                style={{
                  display: "block",
                  color: "#888",
                  fontSize: "0.75rem",
                  fontWeight: 400,
                  marginTop: "0.3rem",
                }}
              >
                Suggested: ~${Math.ceil(budgetTotal / (trip.teamSizeMax || trip.teamSizeMin))}/person, based
                on ${budgetTotal} budgeted ÷ a {trip.teamSizeMax || trip.teamSizeMin}-person team.
              </span>
            )}
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

      {/* Flight itinerary -- replaces the former Trip.flightDetails free
      text (#252 follow-on, per the approved mockup). A repeatable list of
      segments, not one rigid record: the variability is in how many
      segments exist (connections, mixed group/individual bookings), not
      in the shape of one, which is fixed -- same reasoning as
      TripBudgetLine/TripRequirement being lists rather than one wide
      record. Always visible, not toggle-gated -- unlike Budget/Trip
      Requirements, this isn't an opt-in capability, just trip logistics,
      same category as Trip setup above it. label is who a segment is
      for -- blank means the whole team. Shown only on each participant's
      own self-service page, never publicly, same visibility rule
      flightDetails always had. */}
      <div className="admin-section">
        <h3>Flight itinerary</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Entered once after group travel is booked. Shown only on each participant's own self-service page,
          never publicly. Add one row per leg — a connection is two rows; a segment just for part of the team
          can be labeled (e.g. "Priya &amp; John"), leaving the label blank means the whole team.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Airline / Flight #</th>
              <th>Departs</th>
              <th>Arrives</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(trip.flightSegments || []).map((seg) => (
              <tr key={seg.id}>
                <td>
                  <input
                    style={{ width: "9rem" }}
                    defaultValue={seg.label || ""}
                    placeholder="Whole team"
                    onBlur={(e) =>
                      e.target.value !== (seg.label || "") &&
                      handleUpdateFlightSegment(seg.id, { label: e.target.value.trim() || null })
                    }
                  />
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <input
                      style={{ width: "6rem" }}
                      defaultValue={seg.airline || ""}
                      placeholder="Airline"
                      onBlur={(e) =>
                        e.target.value !== (seg.airline || "") &&
                        handleUpdateFlightSegment(seg.id, { airline: e.target.value.trim() || null })
                      }
                    />
                    <input
                      style={{ width: "5rem" }}
                      defaultValue={seg.flightNumber || ""}
                      placeholder="Flight #"
                      onBlur={(e) =>
                        e.target.value !== (seg.flightNumber || "") &&
                        handleUpdateFlightSegment(seg.id, { flightNumber: e.target.value.trim() || null })
                      }
                    />
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <input
                      style={{ width: "4.5rem" }}
                      defaultValue={seg.departureAirport || ""}
                      placeholder="Airport"
                      onBlur={(e) =>
                        e.target.value !== (seg.departureAirport || "") &&
                        handleUpdateFlightSegment(seg.id, { departureAirport: e.target.value.trim() || null })
                      }
                    />
                    <input
                      type="datetime-local"
                      style={{ width: "11rem" }}
                      defaultValue={seg.departureAt ? seg.departureAt.slice(0, 16) : ""}
                      onBlur={(e) =>
                        handleUpdateFlightSegment(seg.id, { departureAt: e.target.value || null })
                      }
                    />
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <input
                      style={{ width: "4.5rem" }}
                      defaultValue={seg.arrivalAirport || ""}
                      placeholder="Airport"
                      onBlur={(e) =>
                        e.target.value !== (seg.arrivalAirport || "") &&
                        handleUpdateFlightSegment(seg.id, { arrivalAirport: e.target.value.trim() || null })
                      }
                    />
                    <input
                      type="datetime-local"
                      style={{ width: "11rem" }}
                      defaultValue={seg.arrivalAt ? seg.arrivalAt.slice(0, 16) : ""}
                      onBlur={(e) => handleUpdateFlightSegment(seg.id, { arrivalAt: e.target.value || null })}
                    />
                  </div>
                </td>
                <td className="table-actions">
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={() => handleDeleteFlightSegment(seg.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {(trip.flightSegments || []).length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#888" }}>
                  No flight segments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <form
          onSubmit={handleAddFlightSegment}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
            marginTop: "0.5rem",
          }}
        >
          <input
            style={{ width: "9rem" }}
            value={newFlightSegment.label}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, label: e.target.value }))}
            placeholder="Who (optional)"
          />
          <input
            style={{ width: "6rem" }}
            value={newFlightSegment.airline}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, airline: e.target.value }))}
            placeholder="Airline"
          />
          <input
            style={{ width: "5rem" }}
            value={newFlightSegment.flightNumber}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, flightNumber: e.target.value }))}
            placeholder="Flight #"
          />
          <input
            style={{ width: "4.5rem" }}
            value={newFlightSegment.departureAirport}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, departureAirport: e.target.value }))}
            placeholder="From"
          />
          <input
            type="datetime-local"
            style={{ width: "11rem" }}
            value={newFlightSegment.departureAt}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, departureAt: e.target.value }))}
          />
          <input
            style={{ width: "4.5rem" }}
            value={newFlightSegment.arrivalAirport}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, arrivalAirport: e.target.value }))}
            placeholder="To"
          />
          <input
            type="datetime-local"
            style={{ width: "11rem" }}
            value={newFlightSegment.arrivalAt}
            onChange={(e) => setNewFlightSegment((f) => ({ ...f, arrivalAt: e.target.value }))}
          />
          <button type="submit" className="btn secondary small">
            + Add flight segment
          </button>
        </form>
      </div>

      {/* Confirmed Team -- simplified (#252 follow-on), renamed from
      "Roster" for a clearer contrast against "Applications awaiting
      review" below it in the new section order. Per-participant document
      upload/request, access-link controls, and task checkboxes all used
      to live crammed into this table's action column; moved to each
      participant's own detail page (linked below) and the Completion by
      participant matrix section, since a requirement x participant
      relationship doesn't actually fit one flat roster row. This table
      is now just "who's on the team." */}
      <div className="admin-section">
        <h3>Confirmed Team</h3>
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
                    $
                    {(trip.contributions || [])
                      .filter((c) => c.participantId === p.id)
                      .reduce((s, c) => s + c.amount, 0)}
                    {p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}
                  </td>
                  <td>
                    {missing.length === 0 ? "—" : `${missing.length} item${missing.length === 1 ? "" : "s"}`}
                  </td>
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
                  No one confirmed yet.
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
      logged on each Confirmed Team row above. Grouped with Requirements/
      Completion by participant since all three are the same topic
      (what's needed, what's on file). */}
      <div className="admin-section">
        <h3>Trip-wide documents</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Shared with the whole team -- an itinerary, packing list, or anything else that isn't specific to
          one person.
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
        <input
          type="file"
          aria-label="Trip-wide document file"
          onChange={(e) => setTripWideFile(e.target.files[0] || null)}
        />
        <button
          type="button"
          className="btn secondary small"
          disabled={!tripWideFile}
          onClick={handleUploadTripWideDocument}
        >
          Upload
        </button>
      </div>

      {/* Requirements -- a document or a plain task (#252 generalization),
      each optionally with its own due date and a reminder lead time.
      Placed after Confirmed Team, not before (its natural reading order --
      you're tracking fulfillment against a confirmed team, which doesn't
      exist until the section above this one). */}
      <div className="admin-section">
        <h3>Trip Requirements</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          What this trip needs from each participant -- a document to upload, or a plain task an admin checks
          off (e.g. "Attended orientation call"). Give one a due date to see it flagged once overdue; add a
          reminder lead time to have anyone who hasn't fulfilled it emailed automatically before it's due.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {(trip.requirements || []).map((r) => {
            const overdue = r.dueAt && new Date(r.dueAt) < new Date();
            return (
              <li
                key={r.id}
                style={{
                  border: "1px solid #e1dfdb",
                  borderRadius: 6,
                  padding: "0.5rem 0.6rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: r.kind === "task" ? "#2a5d8f" : r.kind === "esignature" ? "#a6540f" : "#1f6b4f",
                      background:
                        r.kind === "task" ? "#e8eff7" : r.kind === "esignature" ? "#fbeee0" : "#e7f3ee",
                    }}
                  >
                    {r.kind === "task" ? "Task" : r.kind === "esignature" ? "E-signature" : "Document"}
                  </span>
                  <strong style={{ flex: 1 }}>{r.label}</strong>
                  <label
                    style={{
                      fontWeight: 400,
                      fontSize: "0.8rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}
                  >
                    Due
                    <input
                      type="date"
                      defaultValue={r.dueAt ? r.dueAt.slice(0, 10) : ""}
                      onBlur={(e) => handleSetRequirementDueDate(r.id, e.target.value)}
                      style={{ width: "9.5rem" }}
                    />
                  </label>
                  {r.dueAt && (
                    <label
                      style={{
                        fontWeight: 400,
                        fontSize: "0.8rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.3rem",
                      }}
                    >
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
                {r.kind === "esignature" && (
                  <label
                    style={{ display: "block", marginTop: "0.5rem", fontWeight: 400, fontSize: "0.8rem" }}
                  >
                    Agreement text (shown to the participant before they sign)
                    <textarea
                      rows={4}
                      defaultValue={r.bodyText || ""}
                      onBlur={(e) =>
                        e.target.value !== (r.bodyText || "") &&
                        handleSetRequirementBodyText(r.id, e.target.value)
                      }
                    />
                  </label>
                )}
              </li>
            );
          })}
          {(trip.requirements || []).length === 0 && <p style={{ color: "#888" }}>No requirements yet.</p>}
        </ul>
        <form
          onSubmit={handleAddRequirement}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
        >
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
            <option value="esignature">E-signature</option>
          </select>
          {newRequirement.kind === "esignature" && (
            <textarea
              style={{ flex: "1 1 100%", minWidth: 220 }}
              rows={3}
              placeholder="Agreement text the participant will sign"
              value={newRequirement.bodyText}
              onChange={(e) => setNewRequirement((f) => ({ ...f, bodyText: e.target.value }))}
            />
          )}
          <label
            style={{
              fontWeight: 400,
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
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

      {/* Completion by Team Member -- a matrix (requirement x participant),
      not flattened into Confirmed Team or the requirement-definition list
      above. Matches the data's actual shape: a requirement is defined once
      per trip, but its fulfillment is per participant. Uploading a
      document now happens on that participant's own detail page (linked
      from Confirmed Team); a task can still be toggled directly here
      since that's a trivial one-click action worth keeping inline rather
      than a trip to another page. */}
      <div className="admin-section">
        <h3>Completion by Team Member</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Who's completed what, across the whole team. Upload a document from a participant's own detail page;
          check off a task directly here.
        </p>
        {(trip.requirements || []).length === 0 ? (
          <p style={{ color: "#888" }}>No requirements defined yet -- add one above.</p>
        ) : (trip.participants || []).length === 0 ? (
          <p style={{ color: "#888" }}>No one confirmed yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  {trip.participants.map((p) => (
                    <th key={p.id} style={{ whiteSpace: "nowrap" }}>
                      <Link to={`/admin/trips/${id}/participants/${p.id}`}>
                        {p.firstName} {p.lastName}
                      </Link>
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
                              <span style={{ color: "#b91c1c", fontWeight: 700 }} title="Missing">
                                ✕
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

      {/* Budget -- trip-wide planned-expense line items, estimate-only
      (no actualAmount: nothing else in this app tracks money going out,
      only money coming in -- see TripBudgetLine's own schema comment).
      Toggle-gated by ChurchSettings.enableTripBudgeting, admin-only.
      Placed right before Contributions -- "here's what we need, here's
      what we've got" as one adjacent financial pair, without being
      merged into one section. supportRaisingGoal stays independently
      editable (Trip setup, above) -- never derived from this total,
      just a hint below when the two diverge. */}
      {enableTripBudgeting && (
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
          <form
            onSubmit={handleAddBudgetLine}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "center",
              marginTop: "0.5rem",
            }}
          >
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
            Est. total cost: ${budgetTotal} · Raised: ${raised} · Still needed: $
            {Math.max(budgetTotal - raised, 0)}
          </p>
        </div>
      )}

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
                                {" "}
                                · <strong>Phone:</strong> {a.phone}
                              </>
                            )}
                            {(a.addressLine1 || a.city) && (
                              <>
                                {" "}
                                · <strong>Address:</strong>{" "}
                                {[
                                  a.addressLine1,
                                  a.addressLine2,
                                  a.city,
                                  a.stateProvinceRegion,
                                  a.postalCode,
                                  a.country,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </>
                            )}
                            {(a.emergencyContactName || a.emergencyContactPhone) && (
                              <>
                                {" "}
                                · <strong>Emergency contact:</strong>{" "}
                                {[a.emergencyContactName, a.emergencyContactPhone, a.emergencyContactEmail]
                                  .filter(Boolean)
                                  .join(", ")}
                              </>
                            )}
                          </p>
                          {answersFor(a).length === 0 ? (
                            <p style={{ color: "#888", fontSize: "0.85rem" }}>
                              This trip has no application questions set.
                            </p>
                          ) : (
                            <dl style={{ margin: 0 }}>
                              {answersFor(a).map((q) => (
                                <div key={q.id} style={{ marginBottom: "0.4rem" }}>
                                  <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
                                  <dd style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}>
                                    {q.answer}
                                  </dd>
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
              {showDeclined ? "Hide" : "Show"} declined (
              {applications.filter((a) => a.status === "declined").length})
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
                              <button
                                type="button"
                                className="btn secondary small"
                                onClick={() => handleReconsider(a)}
                              >
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
                                      {" "}
                                      · <strong>Phone:</strong> {a.phone}
                                    </>
                                  )}
                                  {(a.addressLine1 || a.city) && (
                                    <>
                                      {" "}
                                      · <strong>Address:</strong>{" "}
                                      {[
                                        a.addressLine1,
                                        a.addressLine2,
                                        a.city,
                                        a.stateProvinceRegion,
                                        a.postalCode,
                                        a.country,
                                      ]
                                        .filter(Boolean)
                                        .join(", ")}
                                    </>
                                  )}
                                  {(a.emergencyContactName || a.emergencyContactPhone) && (
                                    <>
                                      {" "}
                                      · <strong>Emergency contact:</strong>{" "}
                                      {[
                                        a.emergencyContactName,
                                        a.emergencyContactPhone,
                                        a.emergencyContactEmail,
                                      ]
                                        .filter(Boolean)
                                        .join(", ")}
                                    </>
                                  )}
                                </p>
                                {answersFor(a).length === 0 ? (
                                  <p style={{ color: "#888", fontSize: "0.85rem" }}>
                                    This trip has no application questions set.
                                  </p>
                                ) : (
                                  <dl style={{ margin: 0 }}>
                                    {answersFor(a).map((q) => (
                                      <div key={q.id} style={{ marginBottom: "0.4rem" }}>
                                        <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
                                        <dd
                                          style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}
                                        >
                                          {q.answer}
                                        </dd>
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
          onReorder={handleReorderQuestions}
          library={questionLibrary}
          onAddFromLibrary={handleAddQuestionFromLibrary}
        />
      </div>
      {confirmElement}
    </div>
  );
}
