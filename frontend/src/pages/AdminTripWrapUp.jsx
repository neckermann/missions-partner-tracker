import React, { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { wrapUpTrip } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import Wizard from "../components/shared/Wizard.jsx";
import { toDateInputValue } from "../utils/format.js";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

// The Wrap up trip wizard: finishes a trip in one pass -- confirm what happened, a short
// debrief, a contact for the partner, the loose ends, the photo album, and when the trip leaders'
// access ends. Calling it "Wrap up" keeps it apart from the status "closed" (applications are
// closed, the team is committed), which is not the trip being over. Run again later, it just
// edits the debrief. Open to staff and to a trip leader for their own trip.

// The four prompts, in the order a team talks them through. One plain-text answer each.
export const DEBRIEF_PROMPTS = [
  { key: "whatWeDid", label: "What did the team do?" },
  { key: "wentWell", label: "What went well?" },
  { key: "wasHard", label: "What was hard?" },
  { key: "partnerNeeds", label: "What does the partner need next?" },
];

// A trip leader's access ends this many days after the trip's end date (utils/tripAccessRules.js).
const ACCESS_GRACE_DAYS = 30;

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AdminTripWrapUp() {
  const { trip, setTrip, id, canWrite } = useOutletContext();
  const { enabledFeatures } = useSettings();
  const { isGuest, isOnCareTeamFor } = useCurrentUser();
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(null); // { contactLogged } once saved

  // Whether this trip had been wrapped up before the wizard opened. Fixed at mount: saving updates
  // the trip (completed, with a wrap-up time), and the page must not then call a first wrap-up an edit.
  const [alreadyWrapped] = useState(() => trip.status === "completed" && !!trip.wrappedUpAt);
  // The partner contact: needs the contact log on and a partner, and (for a guest) a care team
  // seat on that partner: a trip leader with a trip grant alone never reaches the contact log.
  const partnerId = trip.partner?.id;
  const mayLogContact =
    !!partnerId &&
    !!enabledFeatures.contactLog &&
    (!isGuest || (isOnCareTeamFor && isOnCareTeamFor(partnerId)));

  if (!canWrite) {
    return (
      <div className="admin-section">
        <p style={{ margin: 0 }}>You can&apos;t wrap up this trip.</p>
        <p style={{ margin: "0.5rem 0 0" }}>
          <Link to={`/admin/trips/${id}`}>Back to the trip</Link>
        </p>
      </div>
    );
  }

  const initialValues = {
    startDate: toDateInputValue(trip.startDate),
    endDate: toDateInputValue(trip.endDate),
    whatWeDid: trip.debriefWhatWeDid || "",
    wentWell: trip.debriefWentWell || "",
    wasHard: trip.debriefWasHard || "",
    partnerNeeds: trip.debriefPartnerNeeds || "",
    logContact: false,
    followUpDate: "",
    albumProvider: trip.albumProvider || "",
    albumUrl: trip.albumUrl || "",
  };

  async function handleFinish(values) {
    setSaving(true);
    setSubmitError("");
    try {
      const payload = {
        // Left out when cleared, never sent as empty: clearing a box here used to erase the trip's own date.
        ...(values.startDate ? { startDate: values.startDate } : {}),
        ...(values.endDate ? { endDate: values.endDate } : {}),
        debrief: {
          whatWeDid: values.whatWeDid,
          wentWell: values.wentWell,
          wasHard: values.wasHard,
          partnerNeeds: values.partnerNeeds,
        },
      };
      if (values.albumUrl) {
        payload.albumProvider = values.albumProvider || "other";
        payload.albumUrl = values.albumUrl;
      }
      if (mayLogContact && values.logContact) {
        payload.followUp = { logContact: true, followUpDate: values.followUpDate || null };
      }
      const result = await wrapUpTrip(id, payload);
      setTrip((t) => ({ ...t, ...result.trip }));
      setDone({ contactLogged: result.contactLogged });
    } catch (err) {
      setSubmitError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't wrap up the trip");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="admin-section" role="status">
        <h3 style={{ marginTop: 0 }}>{alreadyWrapped ? "Debrief saved" : "Trip wrapped up"}</h3>
        <p>
          {alreadyWrapped
            ? "The debrief has been updated."
            : "The trip is marked completed and its debrief is saved on the trip."}
          {done.contactLogged && " A visit was added to the partner's contact log."}
        </p>
        <Link className="btn" to={`/admin/trips/${id}`}>
          Back to the trip
        </Link>
      </div>
    );
  }

  const steps = [
    {
      key: "confirm",
      label: "What happened",
      validate: (v) =>
        v.startDate && v.endDate && v.endDate < v.startDate
          ? "The end date can't be before the start."
          : null,
      render: ({ values, setValue }) => (
        <>
          <p style={{ marginTop: 0 }}>
            Confirm when the trip actually ran. Finishing marks it <strong>completed</strong>.
            {trip.participants?.length > 0 &&
              ` ${trip.participants.length} ${trip.participants.length === 1 ? "person is" : "people are"} on the team.`}
          </p>
          <div className="form-grid">
            <label>
              Actual start
              <input
                type="date"
                value={values.startDate}
                onChange={(e) => setValue("startDate", e.target.value)}
              />
            </label>
            <label>
              Actual end
              <input
                type="date"
                value={values.endDate}
                onChange={(e) => setValue("endDate", e.target.value)}
              />
            </label>
          </div>
        </>
      ),
    },
    {
      key: "debrief",
      label: "Debrief",
      optional: true,
      render: ({ values, setValue }) => (
        <>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            A few lines for whoever looks after this partner next. Every prompt is optional.
          </p>
          {DEBRIEF_PROMPTS.map((p) => (
            <label key={p.key} style={{ display: "block", marginBottom: "0.75rem" }}>
              {p.label}
              <textarea rows={3} value={values[p.key]} onChange={(e) => setValue(p.key, e.target.value)} />
            </label>
          ))}
        </>
      ),
    },
    {
      key: "followups",
      label: "Follow-up",
      optional: true,
      show: () => mayLogContact,
      render: ({ values, setValue }) => (
        <>
          <p style={{ marginTop: 0 }}>
            Add this trip to {trip.partner?.fieldDisplayName || trip.partner?.displayName || "the partner"}
            &apos;s contact log, and set a date to follow up (a thank-you, a check-in on what they need next).
          </p>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={values.logContact}
                onChange={(e) => setValue("logContact", e.target.checked)}
              />
              Log a visit for this trip
            </label>
          </div>
          {values.logContact && (
            <label>
              Follow up by (optional)
              <input
                type="date"
                value={values.followUpDate}
                onChange={(e) => setValue("followUpDate", e.target.value)}
              />
            </label>
          )}
        </>
      ),
    },
    {
      key: "loose",
      label: "Loose ends",
      optional: true,
      render: () => (
        <>
          <p style={{ marginTop: 0 }}>Things still open on this trip. Each opens in its own tab.</p>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            <li>
              <Link to={`/admin/trips/${id}/requirements`}>Requirements</Link>: anything a team member still
              owes.
            </li>
            {trip.enableTripBudgeting && (
              <li>
                <Link to={`/admin/trips/${id}/financial`}>Financial</Link>: contributions and what is still
                unpaid.
              </li>
            )}
            <li>
              <Link to={`/admin/trips/${id}/team`}>Team</Link>: applications and documents.
            </li>
          </ul>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Leaving this page loses nothing: finish here when you&apos;re ready, then look at them.
          </p>
        </>
      ),
    },
    {
      key: "photos",
      label: "Photos",
      optional: true,
      render: ({ values, setValue }) => (
        <>
          <p style={{ marginTop: 0 }}>
            {trip.albumUrl
              ? "This trip already has an album link."
              : "Link the team's photo album so it isn't lost."}
          </p>
          <div className="form-grid">
            <label>
              Where it is
              <select
                value={values.albumProvider}
                onChange={(e) => setValue("albumProvider", e.target.value)}
              >
                <option value="">Not set</option>
                <option value="google_photos">Google Photos</option>
                <option value="icloud">iCloud</option>
                <option value="other">Somewhere else</option>
              </select>
            </label>
            <label>
              Album link
              <input
                type="url"
                value={values.albumUrl}
                onChange={(e) => setValue("albumUrl", e.target.value)}
                placeholder="https://"
              />
            </label>
          </div>
        </>
      ),
    },
    {
      key: "access",
      label: "Access",
      render: ({ values }) => {
        const ends = values.endDate ? addDays(values.endDate, ACCESS_GRACE_DAYS) : null;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              {isGuest ? "Your access to this trip" : "Trip leader access"}{" "}
              {ends ? (
                <>
                  ends on <strong>{ends}</strong> ({ACCESS_GRACE_DAYS} days after the trip ends), unless it
                  was given a different date.
                </>
              ) : (
                `ends ${ACCESS_GRACE_DAYS} days after the trip's end date. Set the end date to see the day.`
              )}
            </p>
            {!isGuest && (
              <p style={{ margin: 0 }}>
                To extend it or end it now, use <Link to={`/admin/trips/${id}/team`}>the Team tab</Link>.
              </p>
            )}
          </>
        );
      },
    },
  ];

  return (
    <div className="admin-section">
      <h3 style={{ marginTop: 0 }}>{alreadyWrapped ? "Trip debrief" : "Wrap up this trip"}</h3>
      <Wizard
        steps={steps}
        initialValues={initialValues}
        onFinish={handleFinish}
        onCancel={() => window.history.back()}
        finishing={saving}
      />
      {submitError && (
        <p style={{ color: "var(--danger)" }} role="alert">
          {submitError}
        </p>
      )}
    </div>
  );
}
