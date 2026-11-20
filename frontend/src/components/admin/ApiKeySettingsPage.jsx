import React, { useEffect, useState } from "react";

export default function ApiKeySettingsPage({
  title,
  description,
  instructions,
  loadErrorMessage,
  saveErrorMessage,
  fetchSettings,
  updateSettings,
}) {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSettings()
      .then((s) => setConfigured(s.configured))
      .catch((err) => setError(err.response?.data?.error || loadErrorMessage))
      .finally(() => setLoading(false));
    // fetchSettings/loadErrorMessage come from the caller's own module-level
    // imports/string literals, never recreated on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateSettings({ apiKey: apiKey.trim() });
      setConfigured(updated.configured);
      setApiKey("");
      setSuccess("API key saved.");
    } catch (err) {
      setError(err.response?.data?.error || saveErrorMessage);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className="admin-section">
      <h3>{title}</h3>
      <p style={{ color: "#555" }}>{description}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSave} className="admin-form">
        <p style={{ color: "#555", fontSize: "0.9rem" }}>{instructions}</p>
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
      </form>
    </div>
  );
}
