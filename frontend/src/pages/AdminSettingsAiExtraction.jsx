import React, { useEffect, useState } from "react";
import { fetchAiExtractionSettings, updateAiExtractionSettings } from "../api/client.js";

// Just an API key -- same shape as AdminSettingsJoshuaProject.jsx. Whether
// the feature actually runs is controlled separately in Enabled Features
// (the "AI request scanning" toggle), not here.
export default function AdminSettingsAiExtraction() {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAiExtractionSettings()
      .then((s) => setConfigured(s.configured))
      .catch((err) => setError(err.response?.data?.error || "Couldn't load AI request scanning settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateAiExtractionSettings({ apiKey: apiKey.trim() });
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
      <h2>AI Request Scanning</h2>
      <p style={{ color: "#555" }}>
        Scans uploaded newsletters and documents for prayer requests and one-time needs using Claude
        (Anthropic). Turn it on in <a href="/admin/settings/features">Enabled Features</a> once a key is saved
        below. Usage is pay-per-scan on the key owner's Anthropic account — a few cents/month at typical
        volume, not a flat fee.
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
            Get an API key at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
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
