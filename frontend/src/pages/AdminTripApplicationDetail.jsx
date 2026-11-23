import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { fetchTrip, fetchTripApplications, reviewTripApplication } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import Wizard from "../components/shared/Wizard.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

// A sibling route, same shape as AdminTripParticipantDetail.jsx (not
// nested under TripDetailLayout's Outlet, so it repeats that page's own
// canWrite/breadcrumb scoping rather than inheriting it) -- not a Modal
// launched from the Team tab. A popup-modal version of this previously
// shipped and was corrected in review, same reasoning as AdminUserForm.jsx:
// a genuine Wizard flow (the Confirm & Notify step below) reads as its own
// page -- breadcrumb, title, Cancel/Next pinned to the viewport bottom --
// not a dialog floating over the Team tab's own tables.
export default function AdminTripApplicationDetail() {
  const { tripId, applicationId } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const { canWrite: globalCanWrite, isTripLeader, scopedTripId } = useCurrentUser();
  // Mirrors AdminTripParticipantDetail.jsx's own canWrite -- this page is a
  // sibling route, not nested under TripDetailLayout's Outlet, so it can't
  // inherit its context and has to repeat the same scope check here.
  const canWrite = globalCanWrite || (isTripLeader && tripId === scopedTripId);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  const [trip, setTrip] = useState(null);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  // The approve flow's own Wizard (Review -> Confirm & Notify, same shell
  // as AdminUserForm.jsx's) and what it produces.
  const [approvingApplication, setApprovingApplication] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approvalResult, setApprovalResult] = useState(null); // { name, email, url, participantId } | null

  const reload = useCallback(() => {
    fetchTrip(tripId).then(setTrip).catch(console.error);
    fetchTripApplications(tripId).then(setApplications).catch(console.error);
  }, [tripId]);

  useEffect(() => {
    reload();
  }, [reload]);

  function backToTeam() {
    navigate(`/admin/trips/${tripId}/team`);
  }

  if (!trip) return <div className="admin-shell">Loading…</div>;

  const application = applications.find((a) => a.id === applicationId);
  if (!application) {
    return (
      <div className="admin-shell">
        <Link to={`/admin/trips/${tripId}/team`}>← Back to team</Link>
        <p>This application couldn't be found.</p>
      </div>
    );
  }

  const answers = (trip.applicationQuestions || []).map((q) => {
    const raw = application.responses?.[q.id];
    const answer = Array.isArray(raw) ? raw.join(", ") : raw;
    return { id: q.id, label: q.label, answer: answer || "(no answer)" };
  });

  async function handleDecline() {
    const result = await confirmDialog({
      title: `Decline ${application.firstName} ${application.lastName}'s application?`,
      body: (
        <ConfirmMessageBody>
          They won't be notified automatically -- the application moves to Declined, and can still be
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
    try {
      await reviewTripApplication(application.id, "declined", result.text);
      backToTeam();
    } catch (err) {
      setError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't decline this application.");
    }
  }

  async function handleReconsider() {
    try {
      await reviewTripApplication(application.id, "pending", null);
      backToTeam();
    } catch (err) {
      setError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't update this application.");
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

  async function handleApprove() {
    setApproving(true);
    setApproveError("");
    try {
      const result = await reviewTripApplication(application.id, "approved", null);
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
        if (participantId) {
          navigate(`/admin/trips/${tripId}/participants/${participantId}`);
        } else {
          backToTeam();
        }
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
    if (participantId) {
      navigate(`/admin/trips/${tripId}/participants/${participantId}`);
    } else {
      backToTeam();
    }
  }

  const approvalSteps = [
    {
      key: "review",
      label: "Review",
      render: () => <ApplicantAnswers application={application} answers={answers} />,
    },
    {
      key: "notify",
      label: "Confirm & Notify",
      render: () => <p>{approvalNotice()}</p>,
    },
  ];

  return (
    <div className="admin-shell">
      <Breadcrumb
        // Same Trip Leader trimming as TripDetailLayout.jsx/
        // AdminTripParticipantDetail.jsx's own breadcrumbs.
        items={
          isTripLeader
            ? [
                ...(trip.partner?.id
                  ? [
                      {
                        label: trip.partner.displayName || "Partner",
                        to: `/admin/partners/${trip.partner.id}`,
                      },
                    ]
                  : []),
                { label: trip.name || trip.type || "Trip", to: `/admin/trips/${tripId}/team` },
                { label: `${application.firstName} ${application.lastName}` },
              ]
            : [
                { label: "Partners", to: "/admin/partners" },
                { label: trip.partner?.displayName || "Partner", to: `/admin/partners/${trip.partner?.id}` },
                { label: "Trips", to: `/admin/trips?partnerId=${trip.partner?.id}` },
                { label: trip.name || trip.type || "Trip", to: `/admin/trips/${tripId}/team` },
                { label: `${application.firstName} ${application.lastName}` },
              ]
        }
      />
      <h2 style={{ margin: "0.5rem 0" }}>
        {application.firstName} {application.lastName}
      </h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        {approvalResult ? (
          <>
            <p>{approvalResult.name} is on the team now. Share their trip access link with them directly:</p>
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
              onFinish={handleApprove}
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
            <ApplicantAnswers application={application} answers={answers} />
            {canWrite && (
              <div className="table-actions" style={{ marginTop: "1rem" }}>
                {application.status === "pending" ? (
                  <>
                    <button className="btn small" onClick={() => setApprovingApplication(true)}>
                      Approve
                    </button>
                    <button className="btn danger small" onClick={handleDecline}>
                      Decline
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn secondary small" onClick={handleReconsider}>
                    Reconsider
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {confirmElement}
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
      {/* Only ever meaningful once this application has actually been
          declined -- `declinedReason` is cleared to null (not left
          undefined) for every other status, so checking truthiness alone
          would still show "(no reason given)" on a pending application
          that was never declined. */}
      {a.status === "declined" && (
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
