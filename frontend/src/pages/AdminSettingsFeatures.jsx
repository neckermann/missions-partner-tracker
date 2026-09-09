import React, { useEffect, useState } from "react";
import { fetchChurchSettings, updateChurchSettings } from "../api/client.js";

// A plain div, not <label> -- .admin-shell label forces flex-direction:
// column (stacked, for the usual label-above-input fields elsewhere in
// this app), which isn't what a toggle row wants. The checkbox itself
// renders as a pill switch via CSS alone (see index.css) -- same
// input[type="checkbox"] every other form in this app uses.
function FeatureToggleRow({ feature, checked, onToggle }) {
  const blockedByEnvVar = feature.requiresEnvVar && !feature.envVarSatisfied;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginTop: "0.9rem" }}>
      <input type="checkbox" checked={checked && !blockedByEnvVar} disabled={blockedByEnvVar} onChange={onToggle} />
      <div>
        <strong>{feature.label}</strong>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>{feature.description}</div>
        {blockedByEnvVar && (
          <div style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
            Requires {feature.requiresEnvVar} to be configured on the server first.
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminSettingsFeatures() {
  const [enabledFeatures, setEnabledFeatures] = useState({});
  const [featureRegistry, setFeatureRegistry] = useState([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchChurchSettings().then((s) => {
      setEnabledFeatures(s?.enabledFeatures || {});
      setFeatureRegistry(s?.featureRegistry || []);
    });
  }, []);

  function toggleFeature(key) {
    const current = enabledFeatures[key] ?? featureRegistry.find((f) => f.key === key)?.defaultEnabled;
    setEnabledFeatures((f) => ({ ...f, [key]: !current }));
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    try {
      const updated = await updateChurchSettings({ enabledFeatures });
      setEnabledFeatures(updated.enabledFeatures || {});
      setSuccess("Saved.");
    } finally {
      setSaving(false);
    }
  }

  // Grouped by what a toggle actually affects (see the `group` field's
  // comment in backend/src/utils/features.js): "public" is the couple of
  // toggles a logged-out visitor can notice at all (the site disappearing
  // at "/" or "/map"); "admin" is everything else, which only ever changes
  // a logged-in admin's own nav.
  const publicFeatures = featureRegistry.filter((f) => f.group === "public");
  const adminFeatures = featureRegistry.filter((f) => f.group !== "public");

  return (
    <form onSubmit={handleSubmit} className="admin-form form-has-floating-actions">
      <p style={{ color: "#555", marginTop: 0 }}>
        Turn off anything this church isn't using — hides it from the admin nav (and, for
        public-facing features, from visitors) without losing any data already on file.
      </p>

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

      {adminFeatures.length > 0 && (
        <div className="admin-section">
          <h3>Admin features</h3>
          {adminFeatures.map((f) => (
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
        {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
      </div>
    </form>
  );
}
