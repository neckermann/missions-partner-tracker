import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChurchSettings, updateChurchSettings } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// Shown once to an admin, the first time they reach the admin area on a site that has never decided
// whether to publish its partners. Either answer (or "Not yet") stores both switches, so the screen never
// comes back; the choice can be changed any time under Settings -> Privacy and safety.
export default function AdminPublicSiteChoice() {
  const navigate = useNavigate();
  const { refreshSettings } = useSettings();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchChurchSettings()
      .then(setSettings)
      .catch(() => setError("Couldn't load your settings."));
  }, []);

  async function choose(show) {
    setSaving(true);
    setError("");
    try {
      await updateChurchSettings({
        enabledFeatures: { ...(settings?.enabledFeatures || {}), publicDirectory: show, publicMap: show },
      });
      refreshSettings();
      navigate("/admin", { replace: true });
    } catch {
      setError("That didn't save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell" style={{ maxWidth: "36rem" }}>
      <h2>Show your partners on a public website?</h2>
      <p>
        Your site can have a public page with a list and a map of your missionaries and organizations, for
        anyone on the internet to see.
      </p>
      <p style={{ color: "var(--muted)" }}>
        Nothing is shown until you choose each partner: a partner only appears when "Show on public site" is
        ticked on their page, and partners start unticked. You can change this at any time under Settings →
        Privacy and safety.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
        <button type="button" className="btn" disabled={saving || !settings} onClick={() => choose(true)}>
          Yes, turn on the public directory and map
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={saving || !settings}
          onClick={() => choose(false)}
        >
          Not yet
        </button>
      </div>
    </div>
  );
}
