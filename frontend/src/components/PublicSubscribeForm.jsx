import React, { useEffect, useState } from "react";
import { fetchPublicPartners, subscribeToDigest } from "../api/client.js";

// Shared by PublicSubscribe.jsx's "subscribe to everyone or pick several"
// page and PublicPartnerDetail.jsx's "follow this partner" form (#202).
// Two modes: with `picker` unset (the follow form's case), the caller
// bakes in a fixed scope (allPartners/partnerIds) and nothing here
// changes -- no picker UI, no partner fetch. With `picker` set (the
// dedicated Subscribe page's case), the form manages its own scope state
// and lets the visitor choose all partners or several specific ones.
export default function PublicSubscribeForm({ allPartners, partnerIds, title, description, picker = false }) {
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Picker-only state -- unused (and nothing fetched) when picker is
  // false, so the fixed-scope caller pays nothing extra.
  const [scopeAllPartners, setScopeAllPartners] = useState(true);
  const [scopePartnerIds, setScopePartnerIds] = useState([]);
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    if (!picker) return;
    fetchPublicPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [picker]);

  function togglePartner(id) {
    setScopePartnerIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  const effectiveAllPartners = picker ? scopeAllPartners : allPartners;
  const effectivePartnerIds = picker ? scopePartnerIds : partnerIds;
  const nothingSelected = picker && !scopeAllPartners && scopePartnerIds.length === 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (nothingSelected) {
      setError("Choose at least one partner, or include all partners.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { message } = await subscribeToDigest({
        email,
        frequency,
        allPartners: effectiveAllPartners,
        partnerIds: effectivePartnerIds,
      });
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
          {picker && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={scopeAllPartners}
                    onChange={(e) => setScopeAllPartners(e.target.checked)}
                    disabled={busy}
                  />
                  Include all partners
                </label>
              </div>
              {!scopeAllPartners && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    padding: "0.5rem",
                  }}
                >
                  {partners.length === 0 ? (
                    <p style={{ color: "#555", fontSize: "0.9rem", margin: 0 }}>No partners available.</p>
                  ) : (
                    partners.map((p) => (
                      <div className="admin-checkbox-row" key={p.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={scopePartnerIds.includes(p.id)}
                            onChange={() => togglePartner(p.id)}
                            disabled={busy}
                          />
                          {p.displayName ?? p.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

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
