import React, { useEffect, useState } from "react";
import {
  fetchDefaultCareLead,
  setDefaultCareLead,
  fetchCareTeamCandidates,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import Field from "../components/admin/Field.jsx";

// Church-wide care team settings (#291). Today that is one thing: the default
// lead -- who key-date reminders go to for a partner with no care team, so a
// birthday never falls on nobody. Optional; with none set, a partner with no
// team simply gets no reminder. Admin only (the route is admin-gated).
export default function AdminSettingsCareTeam() {
  const { enabledFeatures } = useSettings();
  const [lead, setLead] = useState(undefined); // undefined = loading, null = none
  const [candidates, setCandidates] = useState([]);
  // How far ahead a key date is raised, and how long without contact makes a partner quiet (#365).
  const [timings, setTimings] = useState(null); // { keyDateLeadDays, contactStaleDays }
  const [loadError, setLoadError] = useState("");

  const reload = () =>
    fetchDefaultCareLead()
      .then(setLead)
      .catch(() => setLoadError("Couldn't load the care team settings."));

  const reloadTimings = () =>
    fetchChurchSettings()
      .then((s) =>
        setTimings({ keyDateLeadDays: s?.keyDateLeadDays ?? 7, contactStaleDays: s?.contactStaleDays ?? 90 })
      )
      .catch(() => setTimings({ keyDateLeadDays: 7, contactStaleDays: 90 }));

  useEffect(() => {
    reload();
    reloadTimings();
    fetchCareTeamCandidates().then(setCandidates).catch(console.error);
  }, []);

  const label = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Care Team Settings" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Care Team Settings" />

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Default lead</h2>
        <EditableSection
          title="Default lead"
          canEdit
          value={{ userId: lead?.userId || "" }}
          onSave={(draft) => setDefaultCareLead(draft.userId || null)}
          onSaved={reload}
          view={() => (
            <>
              <Field
                label="Default lead"
                value={lead === undefined ? "Loading…" : lead ? lead.name : "None"}
                showEmpty
              />
              <p style={{ color: "#555", marginTop: "0.5rem" }}>
                When a partner has no care team, their reminders and their &ldquo;Partners to reach out
                to&rdquo; go to the default lead instead of nobody. Once a partner has a care team, the
                default lead is no longer told about them. (A Guest default lead only gets the key-date
                reminders: it never widens which partners a guest can see.)
              </p>
            </>
          )}
          edit={(d, set) => (
            <label>
              Default lead
              <select value={d.userId} onChange={(e) => set("userId", e.target.value)}>
                <option value="">None</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {label(u)} ({u.email})
                  </option>
                ))}
              </select>
            </label>
          )}
        />
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Timing</h2>
        <EditableSection
          title="Timing"
          canEdit
          value={{
            keyDateLeadDays: String(timings?.keyDateLeadDays ?? 7),
            contactStaleDays: String(timings?.contactStaleDays ?? 90),
          }}
          onSave={(draft) =>
            updateChurchSettings({
              keyDateLeadDays: Number(draft.keyDateLeadDays),
              contactStaleDays: Number(draft.contactStaleDays),
            })
          }
          onSaved={reloadTimings}
          view={() => (
            <>
              <Field
                label="Key dates are raised"
                value={timings ? `${timings.keyDateLeadDays} days ahead` : "Loading…"}
                showEmpty
              />
              <Field
                label="A partner is quiet after"
                value={timings ? `${timings.contactStaleDays} days without contact` : "Loading…"}
                showEmpty
              />
              <p style={{ color: "#555", marginTop: "0.5rem" }}>
                The same numbers are used on the bell, in the daily email, on My partners and as the default
                in the Last heard from report. The email is still sent at 7am church time.
              </p>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                Raise a key date this many days ahead (1 to 60)
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={d.keyDateLeadDays}
                  onChange={(e) => set("keyDateLeadDays", e.target.value)}
                  required
                />
              </label>
              <label>
                Call a partner quiet after this many days without a logged contact (7 to 365)
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={d.contactStaleDays}
                  onChange={(e) => set("contactStaleDays", e.target.value)}
                  required
                />
              </label>
            </>
          )}
        />
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Key-date reminders</h2>
        <div className="admin-section">
          {enabledFeatures.keyDates ? (
            <p style={{ margin: 0 }}>
              <strong>On.</strong> Each partner&apos;s care team is reminded about coming birthdays,
              anniversaries and supported-since milestones on the bell
              {enabledFeatures.outboundEmail
                ? ", and in one grouped email a day that is sent only on days something is due."
                : ". Turn on Email (Sending) to also send the daily email."}
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              <strong>Off.</strong> Turn on <em>Key-date reminders</em> under Enabled Features to remind care
              teams about birthdays, anniversaries and supported-since milestones.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
