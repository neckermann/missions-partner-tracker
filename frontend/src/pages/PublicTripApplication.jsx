import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import { fetchPublicTrip, fetchPublicTripByToken, submitTripApplication, submitTripApplicationByToken } from "../api/client.js";

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
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
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
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        <p style={{ color: "#6b6f76" }}>
          {trip.fieldDisplayName}
          {trip.startDate ? ` · ${trip.startDate}` : ""}
        </p>
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
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
            </div>
            {(trip.applicationQuestions || []).map((q) => (
              <label key={q.id} style={{ display: "block", marginTop: "0.75rem" }}>
                {q.label} {q.required && <span style={{ color: "#a6540f" }}>*</span>}
                <input
                  required={q.required}
                  value={responses[q.id] || ""}
                  onChange={(e) => setResponses((r) => ({ ...r, [q.id]: e.target.value }))}
                />
              </label>
            ))}
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
