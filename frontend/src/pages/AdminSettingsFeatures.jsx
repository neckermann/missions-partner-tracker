import React, { useEffect, useState } from "react";
import { updateChurchSettings } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

// A feature is on only when it is switched on and everything it `requires` (declared once, in the
// server's feature registry) is on too. `values` holds stored/draft booleans; a missing key is its default.
function makeResolver(registry, values) {
  const byKey = new Map(registry.map((f) => [f.key, f]));
  const stored = (key) => values[key] ?? byKey.get(key)?.defaultEnabled ?? false;
  const effective = (key, seen = new Set()) => {
    const f = byKey.get(key);
    if (!f || seen.has(key) || !stored(key)) return false;
    const next = new Set(seen).add(key);
    return (f.requires || []).every((r) => effective(r, next));
  };
  // What must be on before this can be switched on: runtime requirements plus setup-only prerequisites.
  const unmet = (key) =>
    [...(byKey.get(key)?.requires || []), ...(byKey.get(key)?.setupNeeds || [])].filter((r) => !effective(r));
  const label = (key) => byKey.get(key)?.label || key;
  return { effective, unmet, label };
}

// Within a card, a feature sits right under the last requirement it has in that same card (indented);
// everything else keeps registry order.
function orderWithChildren(features) {
  const inCard = new Set(features.map((f) => f.key));
  const parentOf = (f) => {
    const parents = [...(f.requires || []), ...(f.setupNeeds || [])].filter((r) => inCard.has(r));
    return parents.length ? parents[parents.length - 1] : null;
  };
  const out = [];
  const place = (f, depth) => {
    out.push({ feature: f, nested: depth > 0 });
    features.filter((c) => parentOf(c) === f.key).forEach((c) => place(c, depth + 1));
  };
  features.filter((f) => !parentOf(f)).forEach((f) => place(f, 0));
  return out;
}

// A plain div, not <label>: `.admin-shell label` forces flex-direction: column, which a toggle
// row doesn't want. The checkbox renders as a pill switch via CSS alone (see index.css).
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
        <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{feature.description}</div>
        {feature.withoutEmail && (
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.2rem" }}>
            <em>Without email:</em> {feature.withoutEmail}
          </div>
        )}
        {disabled && disabledNote && (
          <div style={{ fontSize: "0.8rem", color: "var(--warn)", marginTop: "0.2rem" }}>{disabledNote}</div>
        )}
      </div>
    </div>
  );
}

// What a group holds, by name, with each feature's state: so the card says what is inside it and
// what turning something off would hide, not just "All on".
function GroupFeatureList({ features, resolver }) {
  return (
    <ul className="feature-state-list">
      {orderWithChildren(features).map(({ feature: f, nested }) => {
        const on = resolver.effective(f.key);
        const unmet = resolver.unmet(f.key);
        return (
          <li key={f.key} style={nested ? { marginLeft: "1.5rem" } : undefined}>
            <span className={on ? "status-pill good" : "status-pill"}>{on ? "On" : "Off"}</span>
            <span>
              <strong>{f.label}</strong>
              <span className="feature-state-desc">{f.description}</span>
              {f.withoutEmail && (
                <span className="feature-state-desc">
                  <em>Without email:</em> {f.withoutEmail}
                </span>
              )}
              {unmet.length > 0 && (
                <span className="feature-state-desc">
                  Needs {unmet.map(resolver.label).join(" and ")} turned on.
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Each card edits only its own group's keys, but `enabledFeatures` is one JSON column
// server-side: onSave merges the edited subset into the full current object so one group's
// save can't wipe another's toggles.
function FeatureGroupCard({ title, features, registry, enabledFeatures, onSaveGroup, onSaved }) {
  return (
    <EditableSection
      title={title}
      value={Object.fromEntries(features.map((f) => [f.key, enabledFeatures[f.key] ?? f.defaultEnabled]))}
      onSave={onSaveGroup}
      onSaved={onSaved}
      view={() => <GroupFeatureList features={features} resolver={makeResolver(registry, enabledFeatures)} />}
      edit={(d, set) => {
        // Requirements in this card come from the draft; ones in another card from what is saved.
        const resolver = makeResolver(registry, { ...enabledFeatures, ...d });
        return (
          <>
            {orderWithChildren(features).map(({ feature: f, nested }) => {
              const unmet = resolver.unmet(f.key);
              return (
                <FeatureToggleRow
                  key={f.key}
                  feature={f}
                  checked={!!d[f.key]}
                  onToggle={() => set(f.key, !d[f.key])}
                  disabled={unmet.length > 0}
                  nested={nested}
                  disabledNote={`Needs ${unmet.map(resolver.label).join(" and ")} turned on first.`}
                />
              );
            })}
          </>
        );
      }}
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

  // Merge this card's subset into the full enabledFeatures object before saving (one JSON column).
  async function saveGroup(draft) {
    let merged = { ...enabledFeatures, ...draft };
    // A feature whose requirement is off can't run: save it off with its prerequisite (repeat for chains).
    for (let pass = 0; pass < featureRegistry.length; pass++) {
      const resolver = makeResolver(featureRegistry, merged);
      const stale = featureRegistry.filter((f) => merged[f.key] === true && resolver.unmet(f.key).length > 0);
      if (stale.length === 0) break;
      merged = { ...merged, ...Object.fromEntries(stale.map((f) => [f.key, false])) };
    }
    const updated = await updateChurchSettings({ enabledFeatures: merged });
    refreshSettings();
    return updated;
  }

  const publicFeatures = featureRegistry.filter((f) => f.group === "public");
  const coreAdminFeatures = featureRegistry.filter((f) => f.group === "admin" && !f.section);
  const communicationsFeatures = featureRegistry.filter((f) => f.section === "communications");
  const integrationsFeatures = featureRegistry.filter((f) => f.section === "integrations");

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
      <p style={{ color: "var(--muted)" }}>
        Turn off anything this church isn't using — hides it from the admin nav (and, for public-facing
        features, from visitors) without losing any data already on file.
      </p>

      {publicFeatures.length > 0 && (
        <FeatureGroupCard
          title="Public Site"
          features={publicFeatures}
          registry={featureRegistry}
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
            registry={featureRegistry}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
          />
        </div>
      )}

      {communicationsFeatures.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <FeatureGroupCard
            title="Communications"
            features={communicationsFeatures}
            registry={featureRegistry}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
          />
        </div>
      )}

      {integrationsFeatures.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <FeatureGroupCard
            title="Integrations"
            features={integrationsFeatures}
            registry={featureRegistry}
            enabledFeatures={enabledFeatures}
            onSaveGroup={saveGroup}
            onSaved={reload}
          />
        </div>
      )}
    </div>
  );
}
