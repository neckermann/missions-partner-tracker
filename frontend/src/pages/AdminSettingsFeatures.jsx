import React, { useEffect, useState } from "react";
import { updateChurchSettings } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

// A plain div, not <label> -- .admin-shell label forces flex-direction:
// column (stacked, for the usual label-above-input fields elsewhere in
// this app), which isn't what a toggle row wants. The checkbox itself
// renders as a pill switch via CSS alone (see index.css) -- same
// input[type="checkbox"] every other form in this app uses.
function FeatureToggleRow({ feature, checked, onToggle, disabled = false, nested = false, disabledNote }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        marginTop: "0.9rem",
        marginLeft: nested ? "2.25rem" : 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <div>
        <strong>{feature.label}</strong>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>{feature.description}</div>
        {disabled && disabledNote && (
          <div style={{ fontSize: "0.8rem", color: "#92400e", marginTop: "0.2rem" }}>{disabledNote}</div>
        )}
      </div>
    </div>
  );
}

function groupSummary(features, enabledFeatures) {
  const on = features.filter((f) => enabledFeatures[f.key] ?? f.defaultEnabled);
  if (on.length === 0) return "All off";
  if (on.length === features.length) return "All on";
  return `${on.length} of ${features.length} on`;
}

// Each card edits only its own group's keys, but `enabledFeatures` is one
// JSON column server-side -- onSave merges the card's edited subset into
// the full, current object before saving, so one group's save can never
// wipe out another group's already-saved toggles.
function FeatureGroupCard({ title, features, enabledFeatures, onSaveGroup, onSaved, nestedToggle }) {
  return (
    <EditableSection
      title={title}
      value={Object.fromEntries(
        [...features, ...(nestedToggle ? [nestedToggle.feature] : [])].map((f) => [
          f.key,
          enabledFeatures[f.key] ?? f.defaultEnabled,
        ])
      )}
      onSave={onSaveGroup}
      onSaved={onSaved}
      view={() => <p>{groupSummary(features, enabledFeatures)}</p>}
      edit={(d, set) => (
        <>
          {features.map((f) => (
            <React.Fragment key={f.key}>
              <FeatureToggleRow feature={f} checked={!!d[f.key]} onToggle={() => set(f.key, !d[f.key])} />
              {nestedToggle && f.key === nestedToggle.afterKey && (
                <FeatureToggleRow
                  feature={nestedToggle.feature}
                  checked={!!d[nestedToggle.feature.key]}
                  onToggle={() => set(nestedToggle.feature.key, !d[nestedToggle.feature.key])}
                  disabled={!d[nestedToggle.afterKey]}
                  nested
                  disabledNote={nestedToggle.disabledNote}
                />
              )}
            </React.Fragment>
          ))}
        </>
      )}
    />
  );
}

export default function AdminSettingsFeatures() {
  const { refreshSettings } = useSettings();
  const [enabledFeatures, setEnabledFeatures] = useState({});
  const [featureRegistry, setFeatureRegistry] = useState([]);
  const [loadError, setLoadError] = useState("");

  const { settings, error: settingsError } = useChurchSettings();
  useEffect(() => {
    if (settings) {
      setEnabledFeatures(settings?.enabledFeatures || {});
      setFeatureRegistry(settings?.featureRegistry || []);
    }
  }, [settings]);
  useEffect(() => {
    if (settingsError) setLoadError("Couldn't load feature settings.");
  }, [settingsError]);

  async function reload() {
    const updated = await updateChurchSettings({});
    setEnabledFeatures(updated.enabledFeatures || {});
    refreshSettings();
  }

  // Merge this card's edited subset into the full enabledFeatures object,
  // then save the whole thing -- enabledFeatures is one JSON column, so a
  // partial PUT of just this group's keys would otherwise overwrite every
  // other group's toggles with nothing.
  async function saveGroup(draft) {
    let merged = { ...enabledFeatures, ...draft };
    // publicPrayerDigest does nothing without outboundEmail actually
    // sending mail -- force it back off the moment its one real
    // prerequisite goes off, same as before this was split into cards.
    if (!merged.outboundEmail && merged.publicPrayerDigest) {
      merged = { ...merged, publicPrayerDigest: false };
    }
    const updated = await updateChurchSettings({ enabledFeatures: merged });
    refreshSettings();
    return updated;
  }

  const publicFeatures = featureRegistry.filter((f) => f.group === "public");
  const coreAdminFeatures = featureRegistry.filter((f) => f.group === "admin" && !f.section);
  const communicationsFeatures = featureRegistry.filter((f) => f.section === "communications");
  const integrationsFeatures = featureRegistry.filter((f) => f.section === "integrations");
  const publicPrayerDigestFeature = communicationsFeatures.find((f) => f.key === "publicPrayerDigest");
  const communicationsWithoutDigest = communicationsFeatures.filter((f) => f.key !== "publicPrayerDigest");

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Enabled Features" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Enabled Features" />
      <p style={{ color: "#555" }}>
        Turn off anything this church isn't using — hides it from the admin nav (and, for public-facing
        features, from visitors) without losing any data already on file.
      </p>

      {publicFeatures.length > 0 && (
        <FeatureGroupCard
          title="Public Site"
          features={publicFeatures}
          enabledFeatures={enabledFeatures}
          onSaveGroup={saveGroup}
          onSaved={reload}
        />
      )}

      {coreAdminFeatures.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <FeatureGroupCard
            title="Admin Features"
            features={coreAdminFeatures}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
          />
        </div>
      )}

      {communicationsWithoutDigest.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <FeatureGroupCard
            title="Communications"
            features={communicationsWithoutDigest}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
            nestedToggle={
              publicPrayerDigestFeature && {
                afterKey: "outboundEmail",
                feature: publicPrayerDigestFeature,
                disabledNote: "Requires Email (Sending) above to be turned on first.",
              }
            }
          />
        </div>
      )}

      {integrationsFeatures.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <FeatureGroupCard
            title="Integrations"
            features={integrationsFeatures}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
          />
        </div>
      )}
    </div>
  );
}
