import React, { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  updateTrip,
  generateApplicationLink,
  reviewTripApplication,
  addTripParticipant,
} from "../api/client.js";
import { isMinorForTrip } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import Table from "../components/shared/Table.jsx";
import Modal from "../components/Modal.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Wizard from "../components/shared/Wizard.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import { useSettings } from "../context/SettingsContext.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";

// Confirmed Team + the recruiting pipeline that feeds it (Applications,
// the private link, and this trip's own application questions) --
// grouped together since an application becomes a team member and the
// link/questions only exist to produce more applications. Every table
// here is the shared Table component; row click opens either the
// participant's own detail page (Confirmed Team -- same destination its
// "View details" action already goes to) or a Modal with the applicant's
// answers and Approve/Decline/Reconsider (Applications/Declined).
export default function AdminTripTeam() {
  const { trip, setTrip, applications, reload, questionLibrary, confirmDialog, navigate, id, canWrite } =
    useOutletContext();
  const { isTripLeader } = useCurrentUser();
  const settings = useSettings();
  const [error, setError] = useState("");
  const [openApplication, setOpenApplication] = useState(null);
  // The approve flow's own Wizard (Review -> Confirm & Notify, same shell
  // as AdminUserForm.jsx's) and what it produces -- scoped separately from
  // `error` (a page-level banner) since these render inside the
  // application modal itself and reset whenever that modal changes to a
  // different application.
  const [approvingApplication, setApprovingApplication] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approvalResult, setApprovalResult] = useState(null); // { name, email, url, participantId } | null
  const [showDeclined, setShowDeclined] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ firstName: "", lastName: "", email: "" });

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  // Every place that opens/closes/switches the application modal goes
  // through this, so the approve flow's own state can never leak from one
  // application (or one modal session) into the next.
  function openApplicationModal(app) {
    setApprovingApplication(false);
    setApproving(false);
    setApproveError("");
    setApprovalResult(null);
    setOpenApplication(app);
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

  // Decline and reconsider only -- approving has its own confirm-first
  // flow below (handleApprove), since only that status transition creates
  // a participant and can trigger a notification worth previewing.
  async function handleReview(appId, status, declinedReason) {
    try {
      await reviewTripApplication(appId, status, declinedReason);
      openApplicationModal(null);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't update this application.");
    }
  }

  // What approving this application is actually about to do -- read
  // directly off the trip/settings already loaded for this page, no
  // separate preview request needed. Mirrors the exact gating/content the
  // backend route itself applies (see tripParticipants.js's PUT
  // /applications/:id), so this never promises something the approval
  // won't really do.
  function approvalNotice() {
    const hasDates = trip.status !== "completed" && trip.startDate && trip.endDate;
    const outboundOn = !!settings.enabledFeatures?.outboundEmail;
    const now = new Date();
    const futureMeetings = (trip.meetings || []).filter((m) => !m.cancelledAt && new Date(m.startAt) > now);
    const notifiableRequirements = (trip.requirements || []).filter(
      (r) => r.kind === "document" || r.kind === "esignature"
    );
    const extras = [];
    if (futureMeetings.length > 0) {
      extras.push(`${futureMeetings.length} upcoming meeting${futureMeetings.length === 1 ? "" : "s"}`);
    }
    if (notifiableRequirements.length > 0) {
      extras.push(
        `${notifiableRequirements.length} outstanding requirement${notifiableRequirements.length === 1 ? "" : "s"}`
      );
    }
    const extrasText =
      extras.length > 0
        ? ` Their trip page also covers ${extras.join(" and ")} already on this trip -- no separate notice for those.`
        : "";

    if (!hasDates) {
      return "This trip has no dates set, so no welcome message is sent automatically on approval. You can still reach out to them another way.";
    }
    if (outboundOn) {
      return `They'll immediately be emailed a welcome message with their own trip access link.${extrasText}`;
    }
    return `Email sending isn't enabled here, so nothing is sent automatically. After approving, you'll get a link below to send them yourself.${extrasText}`;
  }

  async function handleApprove(application) {
    setApproving(true);
    setApproveError("");
    try {
      const result = await reviewTripApplication(application.id, "approved", null);
      reload();
      if (result?.teamWelcomeEmail?.manualUrl) {
        // Stay right here with the link in view instead of navigating away
        // behind it -- same reasoning as every other manual-fallback fix
        // this pass (AdminUserForm.jsx, AdminTripMeetings.jsx, ...).
        setApprovalResult({
          name: `${application.firstName} ${application.lastName}`.trim(),
          email: application.email,
          url: result.teamWelcomeEmail.manualUrl,
          participantId: result.participant?.id,
        });
      } else {
        const participantId = result?.participant?.id;
        openApplicationModal(null);
        if (participantId) navigate(`/admin/trips/${id}/participants/${participantId}`);
      }
    } catch (err) {
      setApproveError(
        mapServerErrorMessage(err?.response?.data?.error) || "Couldn't approve this application."
      );
    } finally {
      setApproving(false);
    }
  }

  function finishApproval() {
    const participantId = approvalResult?.participantId;
    openApplicationModal(null);
    if (participantId) navigate(`/admin/trips/${id}/participants/${participantId}`);
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

  async function handleAddParticipant() {
    if (!newParticipant.firstName) return false;
    await addTripParticipant(id, newParticipant);
    setNewParticipant({ firstName: "", lastName: "", email: "" });
    reload();
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
    (trip.requirements || [])
      .filter(
        (req) =>
          !req.minorsOnly ||
          isMinorForTrip(
            (trip.participants || []).find((p) => p.id === participantId)?.dateOfBirth,
            trip.startDate
          )
      )
      .map((req) => ({
        id: req.id,
        kind: req.kind,
        overdue: req.dueAt && new Date(req.dueAt) < new Date(),
        fulfilled:
          req.kind === "task"
            ? !!(req.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
            : (trip.documents || []).some(
                (d) => d.requirementId === req.id && d.participantId === participantId
              ),
      }));

  const pending = applications.filter((a) => a.status === "pending");
  const declined = applications.filter((a) => a.status === "declined");

  const teamColumns = [
    {
      key: "name",
      label: "Name",
      render: (p) => (
        <Link to={`/admin/trips/${id}/participants/${p.id}`} onClick={(e) => e.stopPropagation()}>
          {p.firstName} {p.lastName}
        </Link>
      ),
      sortable: true,
      sortBy: (p) => `${p.lastName || ""} ${p.firstName || ""}`.toLowerCase(),
    },
    {
      key: "support",
      label: "Support Raising",
      render: (p) => {
        const raised = (trip.contributions || [])
          .filter((c) => c.participantId === p.id)
          .reduce((s, c) => s + c.amount, 0);
        return `$${raised}${p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}`;
      },
    },
    {
      key: "requirements",
      label: "Requirements",
      render: (p) => {
        const fulfillment = fulfillmentFor(p.id);
        if (fulfillment.length === 0) return "—";
        const done = fulfillment.filter((f) => f.fulfilled).length;
        const overdue = fulfillment.some((f) => !f.fulfilled && f.overdue);
        return (
          <span
            className={`status-pill ${done === fulfillment.length ? "ok" : overdue ? "danger" : "warn"}`}
            title={fulfillment
              .map((f, i) => `${trip.requirements[i]?.label}: ${f.fulfilled ? "done" : "missing"}`)
              .join(", ")}
          >
            {done}/{fulfillment.length} complete{overdue ? " (overdue)" : ""}
          </span>
        );
      },
    },
  ];

  // Approve's own 2-step Wizard -- Review, then Confirm & Notify -- same
  // shell as every other Wizard in the app (AdminUserForm.jsx's Basics/
  // Account Setup). Neither step collects input (values/setValue are
  // unused -- a plain `{}` initialValues is enough), so the steps are
  // read-only content gated purely on reaching Finish; all the real work
  // happens in handleApprove, called from onFinish below.
  const approvalSteps = openApplication
    ? [
        {
          key: "review",
          label: "Review",
          render: () => (
            <ApplicantAnswers application={openApplication} answers={answersFor(openApplication)} />
          ),
        },
        {
          key: "notify",
          label: "Confirm & Notify",
          render: () => <p>{approvalNotice()}</p>,
        },
      ]
    : [];

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        <h3>Confirmed Team</h3>
        <Table
          columns={teamColumns}
          rows={trip.participants || []}
          onRowClick={(p) => navigate(`/admin/trips/${id}/participants/${p.id}`)}
          emptyMessage="No one confirmed yet."
          renderActions={(p) => (
            <Link className="btn secondary small" to={`/admin/trips/${id}/participants/${p.id}`}>
              View details
            </Link>
          )}
        />
        {canWrite && (
          <button
            type="button"
            className="btn secondary small"
            style={{ marginTop: "0.75rem" }}
            onClick={() => setShowAddParticipant(true)}
          >
            + Add participant directly
          </button>
        )}
      </div>

      <div className="admin-section">
        <h3>Applications awaiting review</h3>
        <Table
          columns={[
            { key: "name", label: "Name", render: (a) => `${a.firstName} ${a.lastName}` },
            { key: "submittedAt", label: "Submitted", type: "date" },
          ]}
          rows={pending}
          onRowClick={(a) => openApplicationModal({ ...a, mode: "pending" })}
          emptyMessage="Nothing awaiting review."
        />

        {declined.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn secondary small" onClick={() => setShowDeclined((s) => !s)}>
              {showDeclined ? "Hide" : "Show"} declined ({declined.length})
            </button>
            {showDeclined && (
              <div style={{ marginTop: "0.5rem" }}>
                <Table
                  columns={[
                    { key: "name", label: "Name", render: (a) => `${a.firstName} ${a.lastName}` },
                    { key: "reviewedAt", label: "Declined", type: "date" },
                    {
                      key: "declinedReason",
                      label: "Reason",
                      render: (a) =>
                        a.declinedReason || <span style={{ color: "#888" }}>(no reason given)</span>,
                    },
                  ]}
                  rows={declined}
                  onRowClick={(a) => openApplicationModal({ ...a, mode: "declined" })}
                />
              </div>
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
        {/* Backend blocks this action for a Trip Leader (requireRole on the
        generate-application-link route excludes tripLeader) -- hiding it
        here instead of letting them hit the button and get a misleading
        "check Trip settings" error when the real reason is their role. */}
        {canWrite && !isTripLeader && (
          <button type="button" className="btn secondary small" onClick={handleGenerateLink}>
            {trip.applicationShareToken ? "Regenerate link" : "Generate private application link"}
          </button>
        )}
      </div>

      <div className="admin-section">
        <h3>Application questions</h3>
        <p style={{ color: "#555" }}>
          Added after the church-wide questions (Settings → Trips Settings) on both the public and private
          application forms for this trip specifically.
        </p>
        {canWrite ? (
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
        ) : (trip.applicationQuestions || []).length === 0 ? (
          <p style={{ color: "#888" }}>No extra questions on this trip.</p>
        ) : (
          <ul>
            {(trip.applicationQuestions || []).map((q) => (
              <li key={q.id}>{q.label}</li>
            ))}
          </ul>
        )}
      </div>

      {showAddParticipant && (
        <QuickActionModal
          title="Add Participant Directly"
          onClose={() => setShowAddParticipant(false)}
          onSubmit={handleAddParticipant}
        >
          <div className="form-grid">
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
          </div>
        </QuickActionModal>
      )}

      {openApplication && (
        <Modal
          title={`${openApplication.firstName} ${openApplication.lastName}`}
          onClose={() => openApplicationModal(null)}
        >
          {approvalResult ? (
            <>
              <p>
                {approvalResult.name} is on the team now. Share their trip access link with them directly:
              </p>
              <ManualSendNotice recipients={approvalResult} />
              <div style={{ marginTop: "1rem" }}>
                <button type="button" className="btn" onClick={finishApproval}>
                  Done
                </button>
              </div>
            </>
          ) : approvingApplication ? (
            <>
              <Wizard
                steps={approvalSteps}
                initialValues={{}}
                onFinish={() => handleApprove(openApplication)}
                onCancel={() => setApprovingApplication(false)}
                finishing={approving}
              />
              {approveError && (
                <p className="form-error" role="alert">
                  {approveError}
                </p>
              )}
            </>
          ) : (
            <>
              <ApplicantAnswers application={openApplication} answers={answersFor(openApplication)} />
              {canWrite && (
                <div className="table-actions" style={{ marginTop: "1rem" }}>
                  {openApplication.mode === "pending" ? (
                    <>
                      <button className="btn small" onClick={() => setApprovingApplication(true)}>
                        Approve
                      </button>
                      <button className="btn danger small" onClick={() => handleDecline(openApplication)}>
                        Decline
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => handleReview(openApplication.id, "pending", null)}
                    >
                      Reconsider
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
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
      {a.declinedReason !== undefined && (
        <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
          <strong>Declined reason:</strong> {a.declinedReason || "(no reason given)"}
        </p>
      )}
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
