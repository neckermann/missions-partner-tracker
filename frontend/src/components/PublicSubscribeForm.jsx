import React, { useState } from "react";
import { subscribeToDigest } from "../api/client.js";

// Shared by PublicPrayerWall.jsx's "subscribe to everyone" form and
// PublicPartnerDetail.jsx's "follow this partner" form (#202) -- the only
// difference between the two is which scope the caller bakes in
// (allPartners: true vs. allPartners: false + a single partnerId), so
// there's one form, not two. No partner-picker UI here at all: unlike the
// admin side's own cadence+scope control (AccountSettings.jsx), the
// public surface only ever offers these two fixed scopes.
export default function PublicSubscribeForm({ allPartners, partnerIds, title, description }) {
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { message } = await subscribeToDigest({ email, frequency, allPartners, partnerIds });
      setMessage(message);
      setEmail("");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't subscribe -- please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-subscribe-form">
      {title && <h3>{title}</h3>}
      {description && <p className="public-subscribe-description">{description}</p>}
      {message ? (
        <p className="public-subscribe-success">{message}</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="public-subscribe-row">
            <input
              type="email"
              required
              placeholder="you@example.com"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <select
              aria-label="How often"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              disabled={busy}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Subscribing..." : "Subscribe"}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="public-subscribe-privacy">
            Your email is used only to send these updates — we never share it with anyone else, and you can
            unsubscribe anytime.
          </p>
        </form>
      )}
    </div>
  );
}
