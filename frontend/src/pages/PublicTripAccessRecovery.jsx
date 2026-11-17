import React, { useState } from "react";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import { requestTripParticipantAccessLink } from "../api/client.js";

// New (#252), §4a -- "lost your link" form. One email field, one generic
// confirmation message regardless of what matched server-side (the
// enumeration-prevention guarantee lives in the backend route).
export default function PublicTripAccessRecovery() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await requestTripParticipantAccessLink(email);
      setMessage(res.message);
    } catch {
      setMessage("If that email has a trip participant record, we've sent a new link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PublicSiteHeader title="Lost your trip link?" />
      <DemoBanner />
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <p style={{ color: "#555" }}>
          Enter the email address you used when you applied or were added to a trip roster, and we'll send a
          fresh link.
        </p>
        {message ? (
          <p style={{ color: "#1f6b4f" }}>{message}</p>
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
      </div>
    </div>
  );
}
