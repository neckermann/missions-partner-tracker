import React, { useState } from "react";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import { requestTripParticipantAccessLink } from "../api/client.js";

// "Lost your link" form: one email field and one generic confirmation regardless of what matched
// (the enumeration-prevention guarantee lives in the backend route). A request that failed is never reported
// as sent: the route answers 404 while the church has email (or trips) switched off, and anything else is a
// fault to retry. Neither says whether the address matched anyone.
export default function PublicTripAccessRecovery() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const res = await requestTripParticipantAccessLink(email);
      setMessage(res.message);
    } catch (err) {
      setProblem(
        err?.response?.status === 404
          ? "This church isn't sending trip links by email right now, so nothing was sent. Please ask your trip leader for your link."
          : err?.response?.status === 429
            ? "Too many tries just now, so nothing was sent. Please wait a few minutes and try again."
            : "Something went wrong and nothing was sent. Please try again in a few minutes, or ask your trip leader for your link."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PublicSiteHeader title="Lost your trip link?" />
      <DemoBanner />
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <p style={{ color: "var(--muted)" }}>
          Enter the email address you used when you applied or were added to a trip's team, and we'll send a
          fresh link.
        </p>
        {message ? (
          <p style={{ color: "var(--accent)" }}>{message}</p>
        ) : (
          <form onSubmit={handleSubmit} className="public-subscribe-row">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Sending..." : "Send me a link"}
            </button>
          </form>
        )}
        {problem && !message && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
