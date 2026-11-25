import React, { useEffect, useState } from "react";
import { fetchPublicPartners, subscribeToDigest } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// Labels in display order; also the preference order for a new subscriber's default cadence
// (monthly first), matching routes/settingsDispatches.js's fallback order.
const CADENCE_OPTIONS = [
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
const CADENCE_PREFERENCE = ["monthly", "quarterly", "biweekly"];

// Shared by the Subscribe page and the per-partner follow form. With `picker` unset the caller
// bakes in a fixed scope (allPartners/partnerIds); with `picker` set the form manages its own
// scope and lets the visitor choose all partners or several.
export default function PublicSubscribeForm({ allPartners, partnerIds, title, description, picker = false }) {
  const { cadenceTiersEnabled } = useSettings();
  // Both forms are new-subscriber-only, so only enabled tiers are offered (no saved choice to keep).
  const enabledTiers = CADENCE_PREFERENCE.filter((tier) => cadenceTiersEnabled[tier]);
  const cadenceOptions = CADENCE_OPTIONS.filter((opt) => enabledTiers.includes(opt.value));
  const defaultCadence = enabledTiers[0] || "monthly";

  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState(defaultCadence);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Corrects the pre-selected cadence once real settings land if it is no longer an enabled tier;
  // never overrides a pick still in range.
  useEffect(() => {
    if (!enabledTiers.includes(cadence)) setCadence(defaultCadence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadenceTiersEnabled]);

  // Picker-only state; nothing is fetched when picker is false.
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
        cadence,
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
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "0.5rem",
                  }}
                >
                  {partners.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
                      No partners available.
                    </p>
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
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              disabled={busy}
            >
              {cadenceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
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
            unsubscribe anytime. Besides your chosen schedule, you may occasionally receive an urgent update
            right away.
          </p>
        </form>
      )}
    </div>
  );
}
