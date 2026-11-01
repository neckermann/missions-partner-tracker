import React, { useEffect, useState } from "react";
import { fetchJoshuaProjectSettings, updateJoshuaProjectSettings } from "../api/client.js";

// Just an API key -- unlike GroupMe, there's no group/topic picker here,
// so this page is a lot smaller than AdminSettingsGroupMe.jsx. Whether the
// resulting country stats actually show up at all is controlled
// separately in Enabled Features (the "Joshua Project stats" toggle), not
// here -- once both are true it shows everywhere it always has (a
// partner's admin page and public page, wherever a FIPS country code is
// on file), same as every other feature in this app being a plain on/off.
export default function AdminSettingsJoshuaProject() {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJoshuaProjectSettings()
      .then((s) => setConfigured(s.configured))
      .catch((err) => setError(err.response?.data?.error || "Couldn't load Joshua Project settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateJoshuaProjectSettings({ apiKey: apiKey.trim() });
      setConfigured(updated.configured);
      setApiKey("");
      setSuccess("API key saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the API key.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>Joshua Project</h2>
      <p style={{ color: "#555" }}>
        Shows country-level unreached-people-group statistics on a partner's page. Turn it on in{" "}
        <a href="/admin/settings/features">Enabled Features</a> once a key is saved below.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>API Key</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Get a free API key at{" "}
            <a href="https://joshuaproject.net/api/request" target="_blank" rel="noreferrer">
              joshuaproject.net/api/request
            </a>
            .
          </p>
          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={configured ? "Configured — leave blank to keep it" : "Paste your API key"}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn" disabled={saving || !apiKey.trim()}>
            {saving ? "Saving..." : "Save API Key"}
          </button>
        </div>
      </form>
    </div>
  );
}
