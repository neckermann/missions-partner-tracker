import React, { useEffect, useState } from "react";
import {
  fetchMissionsTeam,
  saveMissionsTeam,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import Field from "../components/admin/Field.jsx";

// Church-wide partner care settings: who looks after partners that have no care team of their own (the
// "missions team", named however this church says it), and the timings the care features share. Admin only.
export default function AdminSettingsPartnerCare() {
  const { enabledFeatures, ownerGroupName, refreshSettings } = useSettings();
  const [team, setTeam] = useState(undefined); // undefined = loading; { members, candidates }
  // How far ahead a key date is raised, and how long without contact makes a partner quiet.
  const [timings, setTimings] = useState(null); // { keyDateLeadDays, contactStaleDays }
  const [loadError, setLoadError] = useState("");

  const reload = () =>
    fetchMissionsTeam()
      .then(setTeam)
      .catch(() => setLoadError("Couldn't load the partner care settings."));

  const reloadTimings = () =>
    fetchChurchSettings()
      .then((s) =>
        setTimings({ keyDateLeadDays: s?.keyDateLeadDays ?? 7, contactStaleDays: s?.contactStaleDays ?? 90 })
      )
      .catch(() => setTimings({ keyDateLeadDays: 7, contactStaleDays: 90 }));

  useEffect(() => {
    reload();
    reloadTimings();
  }, []);

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Partner Care" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  const members = team?.members ?? [];

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Partner Care" />

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Who looks after partners</h2>
        <EditableSection
          title={ownerGroupName}
          canEdit
          value={{ name: ownerGroupName, userIds: members.map((m) => m.id) }}
          onSave={async (draft) => {
            await saveMissionsTeam(draft.userIds);
            await updateChurchSettings({ ownerGroupName: draft.name.trim() || null });
          }}
          onSaved={() => {
            reload();
            refreshSettings?.();
          }}
          view={() => (
            <>
              {team !== undefined && members.length === 0 && (
                <p className="field-warning" role="note">
                  Nobody is on the {ownerGroupName}, so partners without a care team have no one looking after
                  them: no reminders, and nothing on My partners. Pick at least one person.
                </p>
              )}
              <Field
                label={`On the ${ownerGroupName}`}
                value={team === undefined ? "Loading…" : members.map((m) => m.name).join(", ")}
                showEmpty
              />
              <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                The {ownerGroupName} looks after every partner that doesn&apos;t have a care team of its own:
                they get those partners&apos; key-date reminders and &ldquo;Partners to reach out to&rdquo;,
                and see them on My partners.
                {enabledFeatures.careTeam
                  ? " A partner with a care team is looked after by that team instead."
                  : " Turn on Care teams under Enabled Features to give individual partners their own team."}
              </p>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                What do you call this group?
                <input
                  value={d.name}
                  maxLength={60}
                  placeholder="Missions team"
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: "0.75rem 0 0" }}>
                <legend style={{ fontWeight: 600 }}>Who is on it</legend>
                {(team?.candidates ?? []).map((u) => (
                  <label key={u.id} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={d.userIds.includes(u.id)}
                      onChange={(e) =>
                        set(
                          "userIds",
                          e.target.checked ? [...d.userIds, u.id] : d.userIds.filter((id) => id !== u.id)
                        )
                      }
                    />
                    {u.name} ({u.email})
                  </label>
                ))}
              </fieldset>
            </>
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
              <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
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
              <strong>On.</strong> Whoever looks after each partner is reminded about coming birthdays,
              anniversaries and supported-since milestones on the bell
              {enabledFeatures.outboundEmail
                ? ", and in one grouped email a day that is sent only on days something is due."
                : ". Turn on Email (Sending) to also send the daily email."}
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              <strong>Off.</strong> Turn on <em>Key-date reminders</em> under Enabled Features to remind
              people about birthdays, anniversaries and supported-since milestones.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
