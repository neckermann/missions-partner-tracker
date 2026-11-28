import React, { useEffect, useState } from "react";
import {
  fetchDispatchSettings,
  updateDispatchSettings,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

const hint = { color: "var(--muted)", fontSize: "0.9rem" };

// Everything about who can see which partners, in one place that is always in the menu, whatever
// features are switched on. (The two restricted-partner settings used to sit on Settings → Dispatches,
// a page only churches using GroupMe, WhatsApp or email could open, though the initials setting also
// controls the public site.)
export default function AdminSettingsPrivacy() {
  const { refreshSettings } = useSettings();
  const [church, setChurch] = useState(null);
  const [dispatch, setDispatch] = useState(null);
  const [loadError, setLoadError] = useState("");

  async function reload() {
    const [churchSettings, dispatchSettings] = await Promise.all([
      fetchChurchSettings(),
      fetchDispatchSettings(),
    ]);
    setChurch(churchSettings);
    setDispatch(dispatchSettings);
  }

  useEffect(() => {
    reload().catch(() => setLoadError("Couldn't load these settings."));
  }, []);

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Privacy and Safety" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!church || !dispatch) return <p className="admin-shell">Loading…</p>;

  const registry = church.featureRegistry || [];
  const isOn = (key) => {
    const stored = (church.enabledFeatures || {})[key];
    return stored ?? registry.find((f) => f.key === key)?.defaultEnabled ?? false;
  };

  // `enabledFeatures` is one JSON column, so a save merges this card's two keys into the whole object.
  async function savePublicSite(draft) {
    await updateChurchSettings({ enabledFeatures: { ...(church.enabledFeatures || {}), ...draft } });
    refreshSettings();
  }

  async function saveRestricted(patch) {
    setDispatch(await updateDispatchSettings(patch));
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Privacy and Safety" />
      <p style={{ color: "var(--muted)" }}>
        What anyone on the internet can see about your partners, and extra care for partners who work where
        being named publicly could put them at risk.
      </p>

      <EditableSection
        title="What the public can see"
        value={{ publicDirectory: isOn("publicDirectory"), publicMap: isOn("publicMap") }}
        onSave={savePublicSite}
        onSaved={reload}
        view={(v) => (
          <>
            <p>Public directory: {v.publicDirectory ? "On" : "Off"}</p>
            <p>Public map: {v.publicMap ? "On" : "Off"}</p>
            <p style={hint}>
              Even when these are on, only partners marked "Show on public site" appear. Turn both off and
              nobody outside your sign-ins can see any partner.
            </p>
          </>
        )}
        edit={(d, set) => (
          <>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={d.publicDirectory}
                  onChange={(e) => set("publicDirectory", e.target.checked)}
                />
                Public directory
              </label>
            </div>
            <p style={hint}>
              The list of partners on your site's front page, with each partner's own page. Shows only
              partners marked "Show on public site".
            </p>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={d.publicMap}
                  onChange={(e) => set("publicMap", e.target.checked)}
                />
                Public map
              </label>
            </div>
            <p style={hint}>
              The map of where your partners serve. Shows only partners marked "Show on public site".
            </p>
          </>
        )}
      />

      <div style={{ marginTop: "1rem" }}>
        <EditableSection
          title="Partners in sensitive places"
          value={{
            allowRestrictedPartnerDispatch: dispatch.allowRestrictedPartnerDispatch,
            restrictedPartnerInitialsEnabled: dispatch.restrictedPartnerInitialsEnabled,
          }}
          onSave={saveRestricted}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                Updates about them:{" "}
                {v.allowRestrictedPartnerDispatch ? "Recorded, then held for review" : "Never recorded"}
              </p>
              <p>
                Public name:{" "}
                {v.restrictedPartnerInitialsEnabled === false
                  ? "A generic label, no initials"
                  : 'Initials (for example "J.R.")'}
              </p>
            </>
          )}
          edit={(d, set) => (
            <>
              <p style={hint}>
                Mark a partner "Restricted-access location" on their page to use these. On the public site a
                restricted partner never shows their real name, photo or exact location.
              </p>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={d.allowRestrictedPartnerDispatch}
                    onChange={(e) => set("allowRestrictedPartnerDispatch", e.target.checked)}
                  />
                  Record updates about restricted partners
                </label>
              </div>
              <p style={hint}>
                Off (the default) means a restricted partner's prayer requests, needs and newsletters are
                never recorded for sending, so there is nothing to review and nothing can go out by accident.
                On records them like anyone else's, but a person reviews each one before it is sent, in every
                channel at once.
              </p>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={d.restrictedPartnerInitialsEnabled !== false}
                    onChange={(e) => set("restrictedPartnerInitialsEnabled", e.target.checked)}
                  />
                  Show initials for restricted partners
                </label>
              </div>
              <p style={hint}>
                On (the default) shows a restricted partner's initials (for example "J.R.") wherever their
                name would appear: the public site, chat messages and email digests. In a small country,
                initials plus the country can be enough for someone who knows the local mission community to
                work out who it is. Off shows a generic label instead (the field name you set on their page,
                such as "Southeast Asia", or a fixed generic one).
              </p>
            </>
          )}
        />
      </div>
    </div>
  );
}
