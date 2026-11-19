import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import {
  fetchPublicTrip,
  fetchPublicTripByToken,
  submitTripApplication,
  submitTripApplicationByToken,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";

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

// New (#252) -- the public application form. Serves two addressing
// modes: plain id-addressed (only for a listed, accepting_applications,
// isPublic trip) and applicationShareToken-addressed (the private link,
// works regardless of isPublic/publicTripDiscovery, and for a restricted
// partner renders a masked destination instead of 404ing). Renders
// exactly whatever questions that specific trip's applicationQuestions
// defines, nothing hardcoded.
export default function PublicTripApplication() {
  const { id, token } = useParams();
  const [trip, setTrip] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
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
    dateOfBirth: "",
    parentGuardianFirstName: "",
    parentGuardianLastName: "",
    parentGuardianRelationship: "",
    parentGuardianPhone: "",
    parentGuardianEmail: "",
  });
  const [responses, setResponses] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fetcher = token ? fetchPublicTripByToken(token) : fetchPublicTrip(id);
    fetcher.then(setTrip).catch(() => setNotFound(true));
  }, [id, token]);

  if (notFound) {
    return (
      <div>
        <PublicSiteHeader title="Trip Opportunities" />
        <div className="admin-shell">
          <p>This trip couldn't be found.</p>
          <Link to="/trips">← Back to Trip Opportunities</Link>
        </div>
      </div>
    );
  }
  if (!trip) return <div className="admin-shell">Loading…</div>;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const submit = token ? submitTripApplicationByToken : submitTripApplication;
      await submit(token || id, { ...form, responses });
      setSubmitted(true);
      // This is a long form -- the submit button sits well below the fold,
      // so without this the success message renders off-screen above
      // wherever the applicant happened to be scrolled, easy to miss
      // entirely.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't submit -- please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PublicSiteHeader title={`Apply: ${trip.name || trip.type || "Trip"}`} />
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
                color: "#1f6b4f",
                background: "#e7f3ee",
              }}
            >
              {trip.type}
            </span>
          )}
          <p style={{ margin: "0.5rem 0 0", color: "#6b6f76", fontSize: "0.9rem" }}>
            {trip.fieldDisplayName || "Field location to be announced"}
            {formatTripDateRange(trip) ? ` · ${formatTripDateRange(trip)}` : ""}
          </p>
          {trip.description && <p style={{ margin: "0.75rem 0 0" }}>{trip.description}</p>}
        </div>
        {submitted ? (
          <p style={{ color: "#1f6b4f" }}>Thanks! Your application has been submitted.</p>
        ) : (
          <form onSubmit={handleSubmit} className="admin-section">
            <div className="form-grid">
              <label>
                First name
                <input
                  required
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </label>
              <label>
                Last name
                <input
                  required
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label>
                Phone
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
            </div>
            {trip.collectApplicantAddress && (
              <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                <label style={{ gridColumn: "1 / -1" }}>
                  Mailing address
                  <input
                    placeholder="Street address"
                    value={form.addressLine1}
                    onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Address line 2 (optional)
                  <input
                    value={form.addressLine2}
                    onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
                  />
                </label>
                <label>
                  City
                  <input
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </label>
                <label>
                  State/Province
                  <input
                    value={form.stateProvinceRegion}
                    onChange={(e) => setForm((f) => ({ ...f, stateProvinceRegion: e.target.value }))}
                  />
                </label>
                <label>
                  Postal code
                  <input
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  />
                </label>
                <label>
                  Country
                  <input
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {trip.collectEmergencyContact && (
              <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                {/* Not a form label -- a plain section heading, no control
                of its own to associate with (the three fields below each
                have their own). A <label> with nothing inside it fails
                jsx-a11y/label-has-associated-control for exactly that
                reason. */}
                <div style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Emergency contact</div>
                <label>
                  First Name
                  <input
                    value={form.emergencyContactFirstName}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactFirstName: e.target.value }))}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    value={form.emergencyContactLastName}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactLastName: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={form.emergencyContactPhone}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))}
                  />
                </label>
                <label>
                  Email (optional)
                  <input
                    type="email"
                    value={form.emergencyContactEmail}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactEmail: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {/* A real field, not a custom question -- see
            ChurchSettings.collectDateOfBirth's own schema comment. Always
            on, and always required, when this trip collects parent/
            guardian info, regardless of the church-wide defaults. */}
            {trip.collectDateOfBirth && (
              <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                <label>
                  Date of birth{trip.requireDateOfBirth ? "" : " (optional)"}
                  <input
                    type="date"
                    required={trip.requireDateOfBirth}
                    value={form.dateOfBirth}
                    onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {trip.collectParentGuardianInfo && (
              <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                <div style={{ gridColumn: "1 / -1", fontWeight: 600 }}>
                  Parent/guardian (required if the applicant is a minor)
                </div>
                <label>
                  First Name
                  <input
                    value={form.parentGuardianFirstName}
                    onChange={(e) => setForm((f) => ({ ...f, parentGuardianFirstName: e.target.value }))}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    value={form.parentGuardianLastName}
                    onChange={(e) => setForm((f) => ({ ...f, parentGuardianLastName: e.target.value }))}
                  />
                </label>
                <label>
                  Relationship
                  <input
                    placeholder="e.g. Mother, Father, Legal guardian"
                    value={form.parentGuardianRelationship}
                    onChange={(e) => setForm((f) => ({ ...f, parentGuardianRelationship: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={form.parentGuardianPhone}
                    onChange={(e) => setForm((f) => ({ ...f, parentGuardianPhone: e.target.value }))}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.parentGuardianEmail}
                    onChange={(e) => setForm((f) => ({ ...f, parentGuardianEmail: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {(trip.applicationQuestions || []).map((q) => {
              const type = q.type || "text";
              return (
                <label key={q.id} style={{ display: "block", marginTop: "0.75rem" }}>
                  {q.label} {q.required && <span style={{ color: "#a6540f" }}>*</span>}
                  {type === "textarea" && (
                    <textarea
                      rows={3}
                      required={q.required}
                      value={responses[q.id] || ""}
                      onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
                    />
                  )}
                  {type === "select" && (
                    <select
                      required={q.required}
                      value={responses[q.id] || ""}
                      onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
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
                          <label
                            key={opt}
                            style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 400 }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setResponses((r) => {
                                  const current = r[q.id] || [];
                                  const next = e.target.checked
                                    ? [...current, opt]
                                    : current.filter((o) => o !== opt);
                                  return { ...r, [q.id]: next };
                                })
                              }
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
                      onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
                    />
                  )}
                  {type === "date" && (
                    <input
                      type="date"
                      required={q.required}
                      value={responses[q.id] || ""}
                      onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
                    />
                  )}
                </label>
              );
            })}
            <div className="form-save-bar">
              <button type="submit" className="btn" disabled={busy}>
                {busy ? "Submitting..." : "Submit application"}
              </button>
              {error && (
                <span style={{ color: "#b91c1c" }} role="alert">
                  {error}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
