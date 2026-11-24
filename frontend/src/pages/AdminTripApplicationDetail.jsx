import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  fetchTrip,
  fetchTripApplications,
  fetchTripsSettings,
  reviewTripApplication,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import RecordUnavailable, { loadErrorStatus } from "../components/shared/RecordUnavailable.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import LastEdited from "../components/shared/LastEdited.jsx";
import Wizard from "../components/shared/Wizard.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

// A sibling route, same shape as AdminTripParticipantDetail.jsx (not
// nested under TripDetailLayout's Outlet, so it repeats that page's own
// canWrite/breadcrumb scoping rather than inheriting it) -- not a Modal
// launched from the Team tab. A popup-modal version of this previously
// shipped and was corrected in review, same reasoning as AdminUserForm.jsx:
// a genuine Wizard flow reads as its own page -- breadcrumb, title,
// Cancel/Next pinned to the viewport bottom -- not a dialog floating over
// the Team tab's own tables.
//
// One Wizard handles both outcomes -- Decision (Approve or Decline), then
// Confirm -- rather than two separate flows (an approve wizard plus a
// decline confirm-dialog). No separate "Review" step: the applicant's
// details are already fully visible on this page before the Wizard ever
// starts, so re-showing them as the Wizard's own first step was found to
// be pure duplication, not a second look at anything new. The shape is
// identical either way and identical regardless of whether outbound email
// is on; only the Confirm step's own content and the end page after
// Finish change based on what was decided and, for an approval, whether
// email is enabled.
export default function AdminTripApplicationDetail() {
  const { tripId, applicationId } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const { canWrite: globalCanWrite, isGuest, canAccessTrip, loading: userLoading } = useCurrentUser();
  // Mirrors AdminTripParticipantDetail.jsx's own canWrite -- this page is a
  // sibling route, not nested under TripDetailLayout's Outlet, so it can't
  // inherit its context and has to repeat the same scope check here.
  const canWrite = globalCanWrite || canAccessTrip(tripId);

  const [trip, setTrip] = useState(null);
  const [loadError, setLoadError] = useState(null); // 404/403 when the trip can't be shown
  const [applications, setApplications] = useState([]);
  const [tripsSettings, setTripsSettings] = useState(null);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // The Wizard's own end page -- set once Finish actually does something,
  // and the one thing that varies by outcome/decision/outboundEmail. See
  // the component's own header comment.
  const [result, setResult] = useState(null); // { kind, name?, email?, url?, participantId? } | null

  const reload = useCallback(() => {
    setLoadError(null);
    fetchTrip(tripId)
      .then(setTrip)
      .catch((err) => {
        const status = loadErrorStatus(err);
        if (status) setLoadError(status);
        else console.error(err);
      });
    fetchTripApplications(tripId).then(setApplications).catch(console.error);
  }, [tripId]);

  // Closed to a guest (403) and not something they edit. Wait for the user to load first, or a
  // guest fires the request before the page knows they are one.
  useEffect(() => {
    if (userLoading || isGuest) return;
    fetchTripsSettings().then(setTripsSettings).catch(console.error);
  }, [userLoading, isGuest]);

  useEffect(() => {
    reload();
  }, [reload]);

  function backToTeam() {
    navigate(`/admin/trips/${tripId}/team`);
  }

  if (loadError)
    return (
      <RecordUnavailable
        status={loadError}
        what="application"
        backTo="/admin/trips"
        backLabel="Back to Trips"
      />
    );
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

  // Same combined, ordered list the public application form itself
  // renders -- church-wide questions (ChurchSettings.tripApplicationTemplate)
  // first, then this trip's own -- see publicTrips.js's shapeTripForApplicant.
  // Reading only trip.applicationQuestions here (the trip-specific layer
  // alone) was a real bug: any trip using the common case -- entirely
  // church-wide questions, nothing trip-specific added -- showed "no
  // application questions set" despite the applicant having answered real
  // ones, because TripApplication.responses is keyed by question id
  // regardless of which layer it came from.
  const combinedQuestions = [
    ...(tripsSettings?.tripApplicationTemplate || []),
    ...(trip.applicationQuestions || []),
  ];
  const answers = combinedQuestions.map((q) => {
    const raw = application.responses?.[q.id];
    const answer = Array.isArray(raw) ? raw.join(", ") : raw;
    return { id: q.id, label: q.label, answer: answer || "(no answer)" };
  });

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

  // The Decision step's choice drives everything from here on -- same
  // Wizard shape either way, only this function's outcome (and the end
  // page it sets) differs.
  async function handleFinish(values) {
    setSubmitting(true);
    setSubmitError("");
    try {
      if (values.decision === "declined") {
        await reviewTripApplication(application.id, "declined", values.declineReason?.trim() || null);
        setResult({ kind: "declined" });
        return;
      }
      const res = await reviewTripApplication(application.id, "approved", null);
      // teamWelcomeEmail is null exactly when the backend's own gate (trip
      // not completed, both dates set) never fired at all -- not "sent",
      // not "manual", genuinely nothing attempted. Conflating that with
      // "sent" here would tell an admin an email went out when none did,
      // on every trip with no dates yet (a very ordinary state for a
      // still-recruiting trip).
      if (!res?.teamWelcomeEmail) {
        setResult({ kind: "approved-no-dates", participantId: res?.participant?.id });
      } else if (res.teamWelcomeEmail.manualUrl) {
        // Stay right here with the link in view instead of navigating away
        // behind it -- same reasoning as every other manual-fallback fix
        // this pass (AdminUserForm.jsx, AdminTripMeetings.jsx, ...).
        setResult({
          kind: "approved-manual",
          name: `${application.firstName} ${application.lastName}`.trim(),
          email: application.email,
          url: res.teamWelcomeEmail.manualUrl,
          participantId: res.participant?.id,
        });
      } else {
        setResult({ kind: "approved-sent", participantId: res?.participant?.id });
      }
    } catch (err) {
      setSubmitError(
        mapServerErrorMessage(err?.response?.data?.error) || "Couldn't update this application."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function finishResult() {
    const participantId = result?.participantId;
    if (participantId) {
      navigate(`/admin/trips/${tripId}/participants/${participantId}`);
    } else {
      backToTeam();
    }
  }

  const reviewSteps = [
    {
      key: "decision",
      label: "Decision",
      validate: (values) => (values.decision ? null : "Choose Approve or Decline."),
      render: ({ values, setValue }) => (
        <div className="admin-checkbox-row">
          <label>
            <input
              type="radio"
              name="decision"
              checked={values.decision === "approved"}
              onChange={() => setValue("decision", "approved")}
            />
            Approve
          </label>
          <label>
            <input
              type="radio"
              name="decision"
              checked={values.decision === "declined"}
              onChange={() => setValue("decision", "declined")}
            />
            Decline
          </label>
        </div>
      ),
    },
    {
      key: "confirm",
      label: "Confirm",
      render: ({ values, setValue }) =>
        values.decision === "declined" ? (
          <>
            <p>
              They won't be notified automatically -- the application moves to Declined, and can still be
              reconsidered later.
            </p>
            <label>
              Reason (optional, admin-only -- never shown to the applicant)
              <input
                value={values.declineReason}
                onChange={(e) => setValue("declineReason", e.target.value)}
                placeholder="e.g. Team is full, schedule conflict, ..."
              />
            </label>
          </>
        ) : (
          <p>{approvalNotice()}</p>
        ),
    },
  ];

  return (
    <div className="admin-shell">
      <Breadcrumb
        // Same guest trimming as TripDetailLayout.jsx/
        // AdminTripParticipantDetail.jsx's own breadcrumbs.
        items={
          isGuest
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
      <LastEdited name={application.lastEditedByName} at={application.lastEditedAt} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        {result ? (
          <>
            {result.kind === "approved-manual" && (
              <>
                <p>{result.name} is on the team now. Share their trip access link with them directly:</p>
                <ManualSendNotice recipients={result} />
              </>
            )}
            {result.kind === "approved-sent" && (
              <p>They're on the team now, and their welcome email is on its way.</p>
            )}
            {result.kind === "approved-no-dates" && (
              <p>
                They're on the team now. This trip has no dates set yet, so no welcome message was sent
                automatically -- reach out to them another way for now.
              </p>
            )}
            {result.kind === "declined" && (
              <p>This application has been declined. They won't be notified automatically.</p>
            )}
            <div style={{ marginTop: "1rem" }}>
              <button type="button" className="btn" onClick={finishResult}>
                Done
              </button>
            </div>
          </>
        ) : reviewing ? (
          <>
            <Wizard
              steps={reviewSteps}
              initialValues={{ decision: "", declineReason: "" }}
              onFinish={handleFinish}
              onCancel={() => setReviewing(false)}
              finishing={submitting}
            />
            {submitError && (
              <p className="form-error" role="alert">
                {submitError}
              </p>
            )}
          </>
        ) : (
          <>
            <ApplicantAnswers application={application} answers={answers} />
            {canWrite && (
              <div className="table-actions" style={{ marginTop: "1rem" }}>
                {application.status === "pending" ? (
                  <button className="btn small" onClick={() => setReviewing(true)}>
                    Approve or Decline
                  </button>
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
    </div>
  );
}

// Same bold-label/value grid convention as AdminTripParticipantDetail.jsx's
// own "Contact & access" view (ViewField/.form-grid) -- this used to be a
// single run-together paragraph joined with middots, cramped even by
// modal standards and worse now that this page has a full page's width to
// use. Short structured fields go in the grid; a question's own answer
// can run to a paragraph (a textarea response), so those stay a stacked
// label-then-value list instead.
function ApplicantAnswers({ application: a, answers }) {
  const address = [a.addressLine1, a.addressLine2, a.city, a.stateProvinceRegion, a.postalCode, a.country]
    .filter(Boolean)
    .join(", ");
  const emergencyContactName = [a.emergencyContactFirstName, a.emergencyContactLastName]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="form-grid">
        <ViewField label="Email" value={a.email} />
        <ViewField label="Phone" value={a.phone} />
        <ViewField label="Address" value={address} />
        <ViewField label="Emergency contact" value={emergencyContactName} />
        <ViewField label="Emergency phone" value={a.emergencyContactPhone} />
        <ViewField label="Emergency email" value={a.emergencyContactEmail} />
      </div>
      {/* Only ever meaningful once this application has actually been
          declined -- `declinedReason` is cleared to null (not left
          undefined) for every other status, so checking truthiness alone
          would still show "(no reason given)" on a pending application
          that was never declined. */}
      {a.status === "declined" && (
        <div className="form-grid" style={{ marginTop: "0.75rem" }}>
          <ViewField label="Declined reason" value={a.declinedReason || "(no reason given)"} />
        </div>
      )}
      <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Application questions</h4>
      {answers.length === 0 ? (
        <p style={{ color: "#888", fontSize: "0.85rem" }}>This trip has no application questions set.</p>
      ) : (
        <dl style={{ margin: 0 }}>
          {answers.map((q) => (
            <div key={q.id} style={{ marginBottom: "0.6rem" }}>
              <dt style={{ fontSize: "0.75rem", color: "#888", fontWeight: 600 }}>{q.label}</dt>
              <dd style={{ margin: "0.15rem 0 0", fontSize: "0.9rem" }}>{q.answer}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

function ViewField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#888", fontWeight: 600 }}>{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}
