import React, { useEffect, useState } from "react";

// The "one write-only API key, admin-only, GET returns { configured }"
// settings page. AdminSettingsJoshuaProject.jsx and
// AdminSettingsAiExtraction.jsx were this same page almost byte-for-byte,
// differing only in copy/instructions and which fetch/update functions
// they called (see #135) -- mirrors the backend's own
// registerApiKeySetting() factory in routes/settings.js, which collapsed
// the same duplication server-side.
//
// The other Site Administration pages (Backups, Features, GroupMe,
// Branding, About) each have a genuinely different shape -- some have no
// loading state at all, GroupMe has several independent save actions
// sharing one `saving` flag, Branding has a file upload, About has an
// extra sync-all action -- so they deliberately stay page-local rather
// than being forced into this same component.
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

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>{title}</h2>
      <p style={{ color: "#555" }}>{description}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>API Key</h3>
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
        </div>
      </form>
    </div>
  );
}
