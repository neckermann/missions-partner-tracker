import React, { useEffect, useState } from "react";
import { fetchChurchSettings, updateChurchSettings } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// A plain div, not <label> -- .admin-shell label forces flex-direction:
// column (stacked, for the usual label-above-input fields elsewhere in
// this app), which isn't what a toggle row wants. The checkbox itself
// renders as a pill switch via CSS alone (see index.css) -- same
// input[type="checkbox"] every other form in this app uses.
function FeatureToggleRow({ feature, checked, onToggle }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginTop: "0.9rem" }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div>
        <strong>{feature.label}</strong>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>{feature.description}</div>
      </div>
    </div>
  );
}

export default function AdminSettingsFeatures() {
  const { refreshSettings } = useSettings();
  const [enabledFeatures, setEnabledFeatures] = useState({});
  const [featureRegistry, setFeatureRegistry] = useState([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchChurchSettings()
      .then((s) => {
        setEnabledFeatures(s?.enabledFeatures || {});
        setFeatureRegistry(s?.featureRegistry || []);
      })
      .catch(() => setError("Couldn't load feature settings."));
  }, []);

  function toggleFeature(key) {
    const current = enabledFeatures[key] ?? featureRegistry.find((f) => f.key === key)?.defaultEnabled;
    setEnabledFeatures((f) => ({ ...f, [key]: !current }));
    setSuccess("");
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateChurchSettings({ enabledFeatures });
      setEnabledFeatures(updated.enabledFeatures || {});
      // The sidebar/Home tiles read enabledFeatures from SettingsContext,
      // which only fetches once on mount otherwise -- without this they'd
      // keep showing pre-save nav until a full page reload.
      refreshSettings();
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save feature settings.");
    } finally {
      setSaving(false);
    }
  }

  // Grouped by what a toggle actually affects (see the `group` field's
  // comment in backend/src/utils/features.js): "public" is the couple of
  // toggles a logged-out visitor can notice at all (the site disappearing
  // at "/" or "/map"); "admin" is everything else, which only ever
  // changes a logged-in admin's own nav. Within "admin", `section` splits
  // Communications and Integrations into their own blocks below -- same
  // three-way grouping (core / Communications / Integrations) the
  // sidebar and Home tiles already use, so this page reads the same way.
  const publicFeatures = featureRegistry.filter((f) => f.group === "public");
  const coreAdminFeatures = featureRegistry.filter((f) => f.group === "admin" && !f.section);
  const communicationsFeatures = featureRegistry.filter((f) => f.section === "communications");
  const integrationsFeatures = featureRegistry.filter((f) => f.section === "integrations");

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Enabled Features</h2>
      <p style={{ color: "#555" }}>
        Turn off anything this church isn't using — hides it from the admin nav (and, for public-facing
        features, from visitors) without losing any data already on file.
      </p>

      <form onSubmit={handleSubmit} className="admin-form">
        {publicFeatures.length > 0 && (
          <div className="admin-section">
            <h3>Public site</h3>
            {publicFeatures.map((f) => (
              <FeatureToggleRow
                key={f.key}
                feature={f}
                checked={enabledFeatures[f.key] ?? f.defaultEnabled}
                onToggle={() => toggleFeature(f.key)}
              />
            ))}
          </div>
        )}

        {coreAdminFeatures.length > 0 && (
          <div className="admin-section">
            <h3>Admin features</h3>
            {coreAdminFeatures.map((f) => (
              <FeatureToggleRow
                key={f.key}
                feature={f}
                checked={enabledFeatures[f.key] ?? f.defaultEnabled}
                onToggle={() => toggleFeature(f.key)}
              />
            ))}
          </div>
        )}

        {communicationsFeatures.length > 0 && (
          <div className="admin-section">
            <h3>Communications</h3>
            {communicationsFeatures.map((f) => (
              <FeatureToggleRow
                key={f.key}
                feature={f}
                checked={enabledFeatures[f.key] ?? f.defaultEnabled}
                onToggle={() => toggleFeature(f.key)}
              />
            ))}
          </div>
        )}

        {integrationsFeatures.length > 0 && (
          <div className="admin-section">
            <h3>Integrations</h3>
            {integrationsFeatures.map((f) => (
              <FeatureToggleRow
                key={f.key}
                feature={f}
                checked={enabledFeatures[f.key] ?? f.defaultEnabled}
                onToggle={() => toggleFeature(f.key)}
              />
            ))}
          </div>
        )}

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {error && (
            <span style={{ color: "#b91c1c" }} role="alert">
              {error}
            </span>
          )}
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>
    </div>
  );
}
