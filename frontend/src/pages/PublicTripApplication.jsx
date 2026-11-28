import React, { useEffect, useState } from "react";
import EmailInput, { emailHint } from "../components/shared/EmailInput.jsx";
import PhoneField from "../components/shared/PhoneField.jsx";
import { useParams, Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import Wizard from "../components/shared/Wizard.jsx";
import {
  fetchPublicTrip,
  fetchPublicTripByToken,
  submitTripApplication,
  submitTripApplicationByToken,
} from "../api/client.js";
import { formatDate, isMinorForTrip } from "../utils/format.js";

// "Jul 5, 2027" or "Jul 5, 2027 - Jul 14, 2027" (or just the one date if
// they're the same / only one is set) -- same rendering a trip's dates
// get everywhere else public-facing (PublicTripOpportunities.jsx).
function formatTripDateRange(trip) {
  if (!trip.startDate) return null;
  const start = formatDate(trip.startDate);
  if (!trip.endDate) return start;
  const end = formatDate(trip.endDate);
  return start === end ? start : `${start} - ${end}`;
}

const initialValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
  emergencyContactFirstName: "",
  emergencyContactLastName: "",
  emergencyContactPhone: "",
  emergencyContactEmail: "",
  parentGuardianFirstName: "",
  parentGuardianLastName: "",
  parentGuardianRelationship: "",
  parentGuardianPhone: "",
  parentGuardianEmail: "",
  responses: {},
  // Honeypot: hidden off-screen; no real applicant fills it, and the backend (publicTripApplications.js) treats a value as spam.
  website: "",
};

function setResponse(values, setValue, questionId, next) {
  setValue("responses", { ...(values.responses || {}), [questionId]: next });
}

// The public application form. Two addressing modes: id-addressed (only a listed, accepting_applications,
// isPublic trip) and applicationShareToken-addressed (the private link; works regardless of
// isPublic/publicTripDiscovery, and a restricted partner renders a masked destination, not a 404).
// Renders exactly the questions the trip's applicationQuestions defines. Three Wizard steps: applicant
// info; address/emergency/guardian (whichever the trip collects); custom questions plus submit. Step 2
// renders empty rather than vanishing so the step count stays fixed.
export default function PublicTripApplication() {
  const { id, token } = useParams();
  const [trip, setTrip] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [closed, setClosed] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fetcher = token ? fetchPublicTripByToken(token) : fetchPublicTrip(id);
    fetcher.then(setTrip).catch((err) => {
      setClosed(err.response?.data?.code === "applications_closed" ? err.response.data : null);
      setNotFound(true);
    });
  }, [id, token]);

  if (notFound) {
    return (
      <div>
        <PublicSiteHeader title="Trip Opportunities" />
        <div className="admin-shell">
          <p>
            {closed
              ? `Applications for ${closed.tripName} are not open right now.`
              : "This trip couldn't be found."}
          </p>
          <Link to="/trips">← Back to Trip Opportunities</Link>
        </div>
      </div>
    );
  }
  if (!trip) return <div className="admin-shell">Loading…</div>;

  async function handleFinish(values) {
    setBusy(true);
    setError("");
    try {
      const submit = token ? submitTripApplicationByToken : submitTripApplication;
      await submit(token || id, values);
      setSubmitted(true);
      // The submit button is well below the fold on the last step; scroll up so the success message is seen.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't submit -- please try again.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      key: "applicant",
      label: "Your info",
      validate: (values) => {
        if (!values.firstName.trim() || !values.lastName.trim()) return "First and last name are required.";
        if (!values.email.trim()) return "Email is required.";
        if (emailHint(values.email)) return "That email address doesn't look right. Please check it.";
        if (!values.dateOfBirth) {
          return "Date of birth is required.";
        }
        return null;
      },
      render: ({ values, setValue }) => (
        <>
          {/* Honeypot -- off-screen, unlabeled, excluded from tab order. */}
          <input
            type="text"
            name="website"
            value={values.website}
            onChange={(e) => setValue("website", e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
          />
          <div className="form-grid">
            <label>
              First name
              <input
                required
                value={values.firstName}
                onChange={(e) => setValue("firstName", e.target.value)}
              />
            </label>
            <label>
              Last name
              <input
                required
                value={values.lastName}
                onChange={(e) => setValue("lastName", e.target.value)}
              />
            </label>
            <label>
              Email
              <EmailInput required value={values.email} onChange={(e) => setValue("email", e.target.value)} />
            </label>
            <PhoneField
              label="Phone"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => setValue("phone", e.target.value)}
            />
          </div>
          {/* A real field, always required: the minor determination that shows the Parent/guardian step depends on it. */}
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              Date of birth
              <input
                type="date"
                required
                value={values.dateOfBirth}
                onChange={(e) => setValue("dateOfBirth", e.target.value)}
              />
            </label>
          </div>
        </>
      ),
    },
    {
      key: "address-contacts",
      label: "Address & contacts",
      // Address/emergency contact are never required at the field level. Parent/guardian is required exactly
      // when isMinorForTrip is true for the date of birth entered on the previous step.
      validate: (values) => {
        if (!isMinorForTrip(values.dateOfBirth, trip.startDate)) return null;
        const missing =
          !values.parentGuardianFirstName.trim() ||
          !values.parentGuardianLastName.trim() ||
          !values.parentGuardianRelationship.trim() ||
          !values.parentGuardianPhone.trim() ||
          !values.parentGuardianEmail.trim();
        return missing ? "Parent/guardian information is required for an applicant under 18." : null;
      },
      render: ({ values, setValue }) => {
        const isMinor = isMinorForTrip(values.dateOfBirth, trip.startDate);
        return (
          <>
            {trip.collectApplicantAddress && (
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Mailing address
                  <input
                    placeholder="Street address"
                    value={values.addressLine1}
                    onChange={(e) => setValue("addressLine1", e.target.value)}
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Address line 2 (optional)
                  <input
                    value={values.addressLine2}
                    onChange={(e) => setValue("addressLine2", e.target.value)}
                  />
                </label>
                <label>
                  City
                  <input value={values.city} onChange={(e) => setValue("city", e.target.value)} />
                </label>
                <label>
                  State/Province
                  <input
                    value={values.stateProvinceRegion}
                    onChange={(e) => setValue("stateProvinceRegion", e.target.value)}
                  />
                </label>
                <label>
                  Postal code
                  <input value={values.postalCode} onChange={(e) => setValue("postalCode", e.target.value)} />
                </label>
                <label>
                  Country
                  <input value={values.country} onChange={(e) => setValue("country", e.target.value)} />
                </label>
              </div>
            )}
            {trip.collectEmergencyContact && (
              <div className="form-grid" style={{ marginTop: trip.collectApplicantAddress ? "0.75rem" : 0 }}>
                {/* A plain heading, not a <label> (no control to associate; jsx-a11y/label-has-associated-control). */}
                <div style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Emergency contact</div>
                <label>
                  First Name
                  <input
                    value={values.emergencyContactFirstName}
                    onChange={(e) => setValue("emergencyContactFirstName", e.target.value)}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    value={values.emergencyContactLastName}
                    onChange={(e) => setValue("emergencyContactLastName", e.target.value)}
                  />
                </label>
                <PhoneField
                  label="Phone"
                  inputMode="tel"
                  value={values.emergencyContactPhone}
                  onChange={(e) => setValue("emergencyContactPhone", e.target.value)}
                />
                <label>
                  Email (optional)
                  <EmailInput
                    value={values.emergencyContactEmail}
                    onChange={(e) => setValue("emergencyContactEmail", e.target.value)}
                  />
                </label>
              </div>
            )}
            {isMinor && (
              <div
                className="form-grid"
                style={{
                  marginTop: trip.collectApplicantAddress || trip.collectEmergencyContact ? "0.75rem" : 0,
                }}
              >
                <div style={{ gridColumn: "1 / -1", fontWeight: 600 }}>
                  Parent/guardian (required -- the applicant is under 18)
                </div>
                <label>
                  First Name
                  <input
                    required
                    value={values.parentGuardianFirstName}
                    onChange={(e) => setValue("parentGuardianFirstName", e.target.value)}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    required
                    value={values.parentGuardianLastName}
                    onChange={(e) => setValue("parentGuardianLastName", e.target.value)}
                  />
                </label>
                <label>
                  Relationship
                  <input
                    required
                    placeholder="e.g. Mother, Father, Legal guardian"
                    value={values.parentGuardianRelationship}
                    onChange={(e) => setValue("parentGuardianRelationship", e.target.value)}
                  />
                </label>
                <PhoneField
                  label="Phone"
                  inputMode="tel"
                  required
                  value={values.parentGuardianPhone}
                  onChange={(e) => setValue("parentGuardianPhone", e.target.value)}
                />
                <label>
                  Email
                  <EmailInput
                    required
                    value={values.parentGuardianEmail}
                    onChange={(e) => setValue("parentGuardianEmail", e.target.value)}
                  />
                </label>
              </div>
            )}
            {!trip.collectApplicantAddress && !trip.collectEmergencyContact && !isMinor && (
              <p style={{ color: "var(--muted)" }}>
                Nothing else needed here for this trip -- continue to the next step.
              </p>
            )}
          </>
        );
      },
    },
    {
      key: "questions",
      label: "Trip questions",
      validate: (values) => {
        for (const q of trip.applicationQuestions || []) {
          if (!q.required) continue;
          const answer = (values.responses || {})[q.id];
          if (q.type === "checkboxes" ? !(answer || []).length : !answer) {
            return `"${q.label}" is required.`;
          }
        }
        return null;
      },
      render: ({ values, setValue }) =>
        (trip.applicationQuestions || []).length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No additional questions for this trip -- review and submit below.
          </p>
        ) : (
          (trip.applicationQuestions || []).map((q) => {
            const type = q.type || "text";
            const responses = values.responses || {};
            return (
              <label key={q.id} style={{ display: "block", marginTop: "0.75rem" }}>
                {q.label} {q.required && <span style={{ color: "var(--warn)" }}>*</span>}
                {type === "textarea" && (
                  <textarea
                    rows={3}
                    required={q.required}
                    value={responses[q.id] || ""}
                    onChange={(e) => setResponse(values, setValue, q.id, e.target.value)}
                  />
                )}
                {type === "select" && (
                  <select
                    required={q.required}
                    value={responses[q.id] || ""}
                    onChange={(e) => setResponse(values, setValue, q.id, e.target.value)}
                  >
                    <option value="">Select...</option>
                    {(q.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
                {type === "checkboxes" && (
                  <div>
                    {(q.options || []).map((opt) => {
                      const selected = responses[q.id] || [];
                      const checked = selected.includes(opt);
                      return (
                        <label key={opt} className="checkbox-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...selected, opt]
                                : selected.filter((o) => o !== opt);
                              setResponse(values, setValue, q.id, next);
                            }}
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                )}
                {type === "text" && (
                  <input
                    required={q.required}
                    value={responses[q.id] || ""}
                    onChange={(e) => setResponse(values, setValue, q.id, e.target.value)}
                  />
                )}
                {type === "date" && (
                  <input
                    type="date"
                    required={q.required}
                    value={responses[q.id] || ""}
                    onChange={(e) => setResponse(values, setValue, q.id, e.target.value)}
                  />
                )}
              </label>
            );
          })
        ),
    },
  ];

  return (
    <div>
      <PublicSiteHeader plain={Boolean(token)} title={`Apply: ${trip.name || trip.type || "Trip"}`} />
      <DemoBanner />
      <div className="admin-shell form-has-floating-actions" style={{ maxWidth: 640 }}>
        <div className="admin-section" style={{ marginBottom: "1.5rem" }}>
          {trip.type && (
            <span
              style={{
                display: "inline-block",
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                color: "var(--accent)",
                background: "var(--accent-soft)",
              }}
            >
              {trip.type}
            </span>
          )}
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            {trip.fieldDisplayName || "Field location to be announced"}
            {formatTripDateRange(trip) ? ` · ${formatTripDateRange(trip)}` : ""}
          </p>
          {trip.description && <p style={{ margin: "0.75rem 0 0" }}>{trip.description}</p>}
        </div>
        {submitted ? (
          <p style={{ color: "var(--accent)" }}>Thanks! Your application has been submitted.</p>
        ) : (
          <div className="admin-section">
            <Wizard steps={steps} initialValues={initialValues} onFinish={handleFinish} finishing={busy} />
            {error && (
              <p style={{ color: "var(--danger)", marginTop: "0.5rem" }} role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
