import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
// "90, 30" -> [90, 30]; anything that isn't a whole number is dropped (the server also checks the bounds).
const parseDays = (text) =>
  String(text || "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));

export default function AdminSettingsPartnerCare() {
  const { enabledFeatures, ownerGroupName, refreshSettings, cadenceTiersEnabled } = useSettings();
  const [team, setTeam] = useState(undefined); // undefined = loading; { members, candidates }
  // How far ahead a key date is raised, and how long without contact makes a partner quiet.
  const [timings, setTimings] = useState(null); // { keyDateLeadDays, keyDateAdvanceDays, contactStaleDays }
  // The email digest tier a person starts on when added to the missions team ("" = nobody is subscribed for them).
  const [defaultDigest, setDefaultDigest] = useState(undefined);
  const [loadError, setLoadError] = useState("");

  const reload = () =>
    fetchMissionsTeam()
      .then(setTeam)
      .catch(() => setLoadError("Couldn't load the partner care settings."));

  const reloadTimings = () =>
    fetchChurchSettings()
      .then((s) => {
        setTimings({
          keyDateLeadDays: s?.keyDateLeadDays ?? 7,
          keyDateAdvanceDays: s?.keyDateAdvanceDays ?? [90, 30],
          contactStaleDays: s?.contactStaleDays ?? 90,
        });
        setDefaultDigest(s?.defaultDigestCadence || "");
      })
      .catch(() => {
        setTimings({ keyDateLeadDays: 7, keyDateAdvanceDays: [90, 30], contactStaleDays: 90 });
        setDefaultDigest("");
      });

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

      {enabledFeatures.outboundEmail && (
        <div className="admin-section-group">
          <h2 className="admin-group-heading">Email digest</h2>
          <EditableSection
            title="Email digest for new members"
            canEdit
            value={{ cadence: defaultDigest ?? "" }}
            onSave={(draft) => updateChurchSettings({ defaultDigestCadence: draft.cadence || null })}
            onSaved={reloadTimings}
            view={() => (
              <>
                <Field
                  label={`When someone joins the ${ownerGroupName}`}
                  value={
                    defaultDigest === undefined
                      ? "Loading…"
                      : defaultDigest
                        ? `Start them on the ${defaultDigest} digest`
                        : "Don't subscribe them automatically"
                  }
                  showEmpty
                />
                <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                  A new member starts on this digest, covering the partners they look after (their care teams,
                  and the {ownerGroupName}&apos;s partners). They can change or stop it under My account.
                  People who already have a digest are never changed.
                </p>
              </>
            )}
            edit={(d, set) => (
              <label>
                Start new {ownerGroupName} members on
                <select value={d.cadence} onChange={(e) => set("cadence", e.target.value)}>
                  <option value="">No automatic digest</option>
                  {["biweekly", "monthly", "quarterly"]
                    .filter((tier) => cadenceTiersEnabled?.[tier] || tier === d.cadence)
                    .map((tier) => (
                      <option key={tier} value={tier}>
                        {tier[0].toUpperCase() + tier.slice(1)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          />
        </div>
      )}

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Quiet partners</h2>
        <EditableSection
          title="Quiet partners"
          canEdit
          value={{ contactStaleDays: String(timings?.contactStaleDays ?? 90) }}
          onSave={(draft) => updateChurchSettings({ contactStaleDays: Number(draft.contactStaleDays) })}
          onSaved={reloadTimings}
          view={() => (
            <>
              <Field
                label="A partner is quiet after"
                value={timings ? `${timings.contactStaleDays} days without contact` : "Loading…"}
                showEmpty
              />
              <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                Used on the bell, on My partners and as the default in the Last heard from report.
              </p>
            </>
          )}
          edit={(d, set) => (
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
                : ". Turn on Email (Sending) to also send the daily email."}{" "}
              Switch it off under <Link to="/admin/settings/features">Enabled Features</Link>.
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              <strong>Off.</strong> Turn on <em>Key-date reminders</em> under{" "}
              <Link to="/admin/settings/features">Enabled Features</Link> to remind people about birthdays,
              anniversaries and supported-since milestones.
            </p>
          )}
        </div>
        <EditableSection
          title="Key-date timing"
          canEdit
          value={{
            keyDateLeadDays: String(timings?.keyDateLeadDays ?? 7),
            keyDateAdvanceDays: (timings?.keyDateAdvanceDays ?? [90, 30]).join(", "),
          }}
          onSave={(draft) =>
            updateChurchSettings({
              keyDateLeadDays: Number(draft.keyDateLeadDays),
              keyDateAdvanceDays: parseDays(draft.keyDateAdvanceDays),
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
                label="Earlier heads-ups in the digest"
                value={
                  timings?.keyDateAdvanceDays?.length
                    ? timings.keyDateAdvanceDays.map((n) => `${n} days`).join(", ") + " ahead"
                    : "None"
                }
                showEmpty
              />
              <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                The first number is used on the bell, in the daily email and on My partners. Earlier heads-ups
                ride in each person&apos;s email digest, once each. The short daily email goes out at 7am
                church time, and only to someone whose digest wouldn&apos;t reach them before the date.
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
                Earlier heads-ups in the email digest, in days (up to three, e.g. 90, 30; leave empty for
                none)
                <input
                  type="text"
                  inputMode="numeric"
                  value={d.keyDateAdvanceDays}
                  onChange={(e) => set("keyDateAdvanceDays", e.target.value)}
                />
              </label>
            </>
          )}
        />
      </div>
    </div>
  );
}
