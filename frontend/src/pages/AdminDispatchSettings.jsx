import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDispatchSettings, updateDispatchSettings, fetchScopedDigestSummary } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { joinWithAnd } from "../utils/urgentSend.js";
import TemplatePackButtons from "../components/admin/TemplatePackButtons.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import StatTiles from "../components/shared/StatTiles.jsx";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

function HourSelect({ id, value, onChange }) {
  return (
    <select id={id} value={value ?? ""} onChange={onChange} style={{ width: "auto" }}>
      <option value="">Not set</option>
      {Array.from({ length: 24 }, (_, h) => h).map((hour) => (
        <option key={hour} value={hour}>
          {hourLabel(hour)}
        </option>
      ))}
    </select>
  );
}

function hourSummary(value) {
  return value == null ? "Not set" : hourLabel(value);
}

// Email dispatch schedule, chat-channel schedule and content mutes, and email appearance, each its own
// EditableSection card. (The restricted-partner settings moved to Settings → Privacy and safety.)
// The review queue lives on the separate "Pending Dispatches" page.
export default function AdminDispatchSettings() {
  const { enabledFeatures } = useSettings();
  const chatNames = [enabledFeatures.groupme && "GroupMe", enabledFeatures.whatsapp && "WhatsApp"].filter(
    Boolean
  );
  const chatLabel = joinWithAnd(chatNames);
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState("");

  async function reload() {
    const [dispatchSettings, summaryResult] = await Promise.all([
      fetchDispatchSettings(),
      enabledFeatures.publicPrayerDigest ? fetchScopedDigestSummary() : Promise.resolve(null),
    ]);
    setSettings(dispatchSettings);
    setSummary(summaryResult);
  }

  useEffect(() => {
    reload().catch(() => setLoadError("Couldn't load the sending settings."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledFeatures.publicPrayerDigest]);

  async function savePartial(patch) {
    const updated = await updateDispatchSettings(patch);
    setSettings(updated);
  }

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Sending updates" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!settings) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title="Sending updates"
        actions={
          <TemplatePackButtons
            importLabel="Import wording…"
            exportKind="dispatchWording"
            onImported={reload}
          />
        }
      />
      <p style={{ color: "var(--muted)" }}>
        Schedules for the admin and public update emails and for {chatLabel || "GroupMe/WhatsApp"}, the chat
        channels' choice of what gets posted, and how the update email looks. The settings for partners in
        sensitive places are under <Link to="/admin/settings/privacy">Privacy and safety</Link>. To review or
        edit what's currently queued, see the <strong>Updates to share</strong> page in the main menu.
      </p>

      {enabledFeatures.publicPrayerDigest && (
        <div className="admin-section">
          <h3>Who gets update emails</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Who's subscribed to the email prayer digest -- admins via Account Settings, and the public via the
            Subscribe page or a partner's own public page. Counts only, no email addresses.
          </p>
          {summary ? (
            <StatTiles
              ariaLabel="Email subscriber counts"
              items={[
                { label: "Admin accounts subscribed", value: summary.adminSubscribedCount },
                { label: "Confirmed public subscribers", value: summary.publicConfirmedCount },
                { label: "Awaiting confirmation", value: summary.publicUnconfirmedCount },
              ]}
            />
          ) : (
            <p>Loading…</p>
          )}
        </div>
      )}

      {enabledFeatures.outboundEmail && (
        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="How the update email looks"
            value={{
              emailDispatchLayout: settings.emailDispatchLayout || "classic",
              emailDispatchSubjectTemplate: settings.emailDispatchSubjectTemplate || "",
              emailDispatchSignature: settings.emailDispatchSignature || "",
            }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <>
                <p>Layout: {v.emailDispatchLayout === "snapshot" ? "Snapshot" : "Classic"}</p>
                <p style={{ color: "var(--muted)" }}>
                  Subject: {v.emailDispatchSubjectTemplate || "Default"}
                </p>
              </>
            )}
            edit={(d, set) => (
              <>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                  Shared by the admin email and the public email -- subject line, signature, and layout look
                  the same for both audiences. The admin email always includes every item it's allowed to; the
                  public email is always prayer-requests-only.
                </p>
                <label>
                  Layout
                  <select
                    value={d.emailDispatchLayout}
                    onChange={(e) => set("emailDispatchLayout", e.target.value)}
                    style={{ width: "auto" }}
                  >
                    <option value="classic">Classic -- text only</option>
                    <option value="snapshot">
                      Snapshot -- adds each partner's photo, field, and overview
                    </option>
                  </select>
                </label>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                  Snapshot shows each partner's photo (or a generic silhouette if they don't have one, or if
                  they're a restricted-access partner), field, "Partnering since" year, and short overview
                  above their items -- for both the admin email and the public email.
                </p>
                <label style={{ marginTop: "1rem" }}>
                  Subject line
                  <input
                    value={d.emailDispatchSubjectTemplate}
                    onChange={(e) => set("emailDispatchSubjectTemplate", e.target.value)}
                    placeholder="e.g. Your {cadence} Update -- {month} {year}"
                  />
                </label>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                  Leave blank for the default: <code>{"{date} {church} - {term} Updates"}</code> -- e.g.
                  "November 4, 2026 Hillside Community Church - Missionary Updates". Use any of these anywhere
                  in your own wording: <code>{"{church}"}</code>, <code>{"{month}"}</code>,{" "}
                  <code>{"{year}"}</code>, <code>{"{date}"}</code>, <code>{"{cadence}"}</code>{" "}
                  (Biweekly/Monthly/Quarterly), <code>{"{name}"}</code> (the recipient's own name),{" "}
                  <code>{"{term}"}</code> (your Partner Terminology setting, e.g. "Missionary").
                </p>
                <label style={{ marginTop: "1rem" }}>
                  Signature
                  <textarea
                    rows={3}
                    value={d.emailDispatchSignature}
                    onChange={(e) => set("emailDispatchSignature", e.target.value)}
                    placeholder="An optional closing line -- a verse, a closing phrase, 'Questions? Contact us', etc."
                  />
                </label>
              </>
            )}
          />
        </div>
      )}

      {enabledFeatures.outboundEmail && (
        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="Email Schedule"
            value={{
              emailDispatchDayOfWeek: settings.emailDispatchDayOfWeek,
              emailDispatchDayOfMonth: settings.emailDispatchDayOfMonth,
              emailDispatchHour: settings.emailDispatchHour,
              cadenceBiweeklyEnabled: settings.cadenceBiweeklyEnabled,
              cadenceMonthlyEnabled: settings.cadenceMonthlyEnabled,
              cadenceQuarterlyEnabled: settings.cadenceQuarterlyEnabled,
            }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <>
                <p>
                  Offered:{" "}
                  {[
                    v.cadenceBiweeklyEnabled && "Biweekly",
                    v.cadenceMonthlyEnabled && "Monthly",
                    v.cadenceQuarterlyEnabled && "Quarterly",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"}
                </p>
                <p>
                  Biweekly day:{" "}
                  {v.emailDispatchDayOfWeek != null ? DAY_NAMES[v.emailDispatchDayOfWeek] : "Not set"}
                </p>
                <p>Monthly/quarterly day: {v.emailDispatchDayOfMonth ?? "Not set"}</p>
                <p>Time: {hourSummary(v.emailDispatchHour)}</p>
              </>
            )}
            edit={(d, set) => (
              <>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                  How often each admin (from their own <a href="/admin/account">Account Settings</a>) and each
                  public subscriber (from the Subscribe page or a partner's own "follow this partner" form)
                  picks to hear from you. Nothing sends for a choice until its schedule here is actually set.
                </p>
                <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  Choose which options people can pick. Turning one off moves anyone on it to the first option
                  still on, in order Monthly, Quarterly, Biweekly -- a one-time move, not undone by turning it
                  back on later. At least one option must stay on.
                </p>
                <div className="admin-checkbox-row" style={{ marginBottom: "1rem" }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={d.cadenceBiweeklyEnabled}
                      onChange={(e) => set("cadenceBiweeklyEnabled", e.target.checked)}
                    />
                    Biweekly
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={d.cadenceMonthlyEnabled}
                      onChange={(e) => set("cadenceMonthlyEnabled", e.target.checked)}
                    />
                    Monthly
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={d.cadenceQuarterlyEnabled}
                      onChange={(e) => set("cadenceQuarterlyEnabled", e.target.checked)}
                    />
                    Quarterly
                  </label>
                </div>
                <label>
                  Day of week (biweekly)
                  <select
                    value={d.emailDispatchDayOfWeek ?? ""}
                    onChange={(e) =>
                      set("emailDispatchDayOfWeek", e.target.value === "" ? null : Number(e.target.value))
                    }
                    style={{ width: "auto" }}
                  >
                    <option value="">Not set -- biweekly won't send</option>
                    {DAY_NAMES.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ marginTop: "1rem" }}>
                  Day of month (monthly & quarterly)
                  <select
                    value={d.emailDispatchDayOfMonth ?? ""}
                    onChange={(e) =>
                      set("emailDispatchDayOfMonth", e.target.value === "" ? null : Number(e.target.value))
                    }
                    style={{ width: "auto" }}
                  >
                    <option value="">Not set -- these emails won't send</option>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="email-dispatch-hour" style={{ marginTop: "1rem" }}>
                  Time of day (the same for all three)
                  <HourSelect
                    id="email-dispatch-hour"
                    value={d.emailDispatchHour}
                    onChange={(e) =>
                      set("emailDispatchHour", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </label>
              </>
            )}
          />
        </div>
      )}

      {(enabledFeatures.groupme || enabledFeatures.whatsapp) && (
        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title={`${chatLabel} Schedule`}
            value={{
              chatDispatchHour: settings.chatDispatchHour,
              chatDispatchPrayerRequests: settings.chatDispatchPrayerRequests,
              chatDispatchOneTimeNeeds: settings.chatDispatchOneTimeNeeds,
              chatDispatchNewsletters: settings.chatDispatchNewsletters,
              chatDispatchKeyDates: settings.chatDispatchKeyDates,
              chatDispatchQuietPartners: settings.chatDispatchQuietPartners,
              chatDispatchUpdatesToPass: settings.chatDispatchUpdatesToPass,
            }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <>
                <p>Time: {hourSummary(v.chatDispatchHour)}</p>
                <p style={{ color: "var(--muted)" }}>
                  Muted:{" "}
                  {[
                    !v.chatDispatchPrayerRequests && "Prayer Requests",
                    !v.chatDispatchOneTimeNeeds && "One-Time Needs",
                    !v.chatDispatchNewsletters && "Newsletters",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"}
                </p>
                <p style={{ color: "var(--muted)" }}>
                  Partner care posts:{" "}
                  {[
                    v.chatDispatchKeyDates && "Key dates",
                    v.chatDispatchQuietPartners && "Quiet partners",
                    v.chatDispatchUpdatesToPass && "News to pass on",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None (off)"}
                </p>
              </>
            )}
            edit={(d, set) => (
              <>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                  A single daily time, not a weekly or monthly schedule --{" "}
                  {chatNames.length > 1
                    ? "these are near-real-time, chat-style channels"
                    : "this is a near-real-time, chat-style channel"}
                  , so posts are collected and sent once a day rather than on a longer email-style schedule.
                </p>
                <label htmlFor="chat-dispatch-hour">
                  Time
                  <HourSelect
                    id="chat-dispatch-hour"
                    value={d.chatDispatchHour}
                    onChange={(e) =>
                      set("chatDispatchHour", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </label>

                <p style={{ margin: "1.25rem 0 0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  Untick anything you don't want posted to {chatLabel} -- unlike the update emails, which
                  always include everything they're allowed to, chat benefits from finer control since it's a
                  live conversation, not a periodic email.
                </p>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={d.chatDispatchPrayerRequests}
                      onChange={(e) => set("chatDispatchPrayerRequests", e.target.checked)}
                    />
                    Prayer Requests
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={d.chatDispatchOneTimeNeeds}
                      onChange={(e) => set("chatDispatchOneTimeNeeds", e.target.checked)}
                    />
                    One-Time Needs
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={d.chatDispatchNewsletters}
                      onChange={(e) => set("chatDispatchNewsletters", e.target.checked)}
                    />
                    Newsletters
                  </label>
                </div>

                <p style={{ margin: "1.25rem 0 0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  Partner care posts are off until you turn them on. They share one Partner Care topic (or
                  group) on the {chatLabel} settings page. Restricted partners are named by initials only.
                </p>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!d.chatDispatchKeyDates}
                      onChange={(e) => set("chatDispatchKeyDates", e.target.checked)}
                    />
                    Key dates coming up (needs Key-date reminders on)
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!d.chatDispatchQuietPartners}
                      onChange={(e) => set("chatDispatchQuietPartners", e.target.checked)}
                    />
                    Partners nobody has heard from (needs Contact log on)
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!d.chatDispatchUpdatesToPass}
                      onChange={(e) => set("chatDispatchUpdatesToPass", e.target.checked)}
                    />
                    News to pass on to a partner (needs Contact log on)
                  </label>
                </div>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}
