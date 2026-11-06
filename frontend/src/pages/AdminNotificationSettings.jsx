import React, { useEffect, useState } from "react";
import {
  fetchNotificationSettings,
  updateNotificationSettings,
  fetchScopedDigestSummary,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

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

// Settings governing the admin+public email digest's own schedule,
// GroupMe's own independent daily schedule and content-type mutes, the
// one cross-channel restricted-partner safety gate, digest appearance,
// and (merged in here, not a separate page) public digest subscriber
// counts. The actual review queue (what's waiting to send) is its own
// top-level "Pending Notifications" page, same "content, not settings"
// split Unmatched Emails already has from Email's own settings page.
export default function AdminNotificationSettings() {
  const { enabledFeatures } = useSettings();
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    Promise.all([
      fetchNotificationSettings(),
      enabledFeatures.publicPrayerDigest ? fetchScopedDigestSummary() : Promise.resolve(null),
    ])
      .then(([notificationSettings, summaryResult]) => {
        setSettings(notificationSettings);
        setSummary(summaryResult);
      })
      .catch((err) => setError(err.response?.data?.error || "Couldn't load notification settings."))
      .finally(() => setLoading(false));
  }, [enabledFeatures.publicPrayerDigest]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateNotificationSettings(settings);
      setSettings(updated);
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Notifications</h2>
      <p style={{ color: "#555" }}>
        Schedules for the admin/public email digest and for GroupMe, GroupMe's own content-type mutes, the
        restricted-partner safety gate, and digest appearance. To review or edit what's currently queued, see
        the <strong>Pending Notifications</strong> page in the main menu.
      </p>

      <form onSubmit={handleSave} className="admin-form">
        {enabledFeatures.publicPrayerDigest && (
          <div className="admin-section">
            <h3>Prayer Digest Subscribers</h3>
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              Who's subscribed to the email prayer digest -- admins via Account Settings, and the public via
              the Subscribe page or a partner's own public page. Counts only, no email addresses.
            </p>
            {summary ? (
              <div className="admin-card-grid">
                <div className="admin-card" style={{ cursor: "default" }}>
                  <h3>{summary.adminSubscribedCount}</h3>
                  <p>Admin account(s) subscribed.</p>
                </div>
                <div className="admin-card" style={{ cursor: "default" }}>
                  <h3>{summary.publicConfirmedCount}</h3>
                  <p>Confirmed public subscribers.</p>
                </div>
                <div className="admin-card" style={{ cursor: "default" }}>
                  <h3>{summary.publicUnconfirmedCount}</h3>
                  <p>Public subscribers awaiting confirmation.</p>
                </div>
              </div>
            ) : (
              <p>Loading…</p>
            )}
          </div>
        )}

        <div className="admin-section" style={{ marginTop: "1rem" }}>
          <h3>Restricted Partners</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            The one safety setting that applies equally to every notification channel this church has
            enabled, not just one. Off (default) means a restricted-access partner's events are never
            recorded at all -- nothing to hold, nothing to review, since nothing's queued. On records them
            like anyone else, subject to review -- either from the Pending Notifications page afterward, or
            right away with the "Review and approve now" checkbox when the prayer request or one-time need
            is first created. Either path clears a row for every channel at once, including an urgent send.
          </p>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={settings.allowRestrictedPartnerNotifications}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, allowRestrictedPartnerNotifications: e.target.checked }))
                }
              />
              Restricted partners
            </label>
          </div>
        </div>

        {enabledFeatures.outboundEmail && (
          <div className="admin-section" style={{ marginTop: "1rem" }}>
            <h3>Digest Customization</h3>
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              Shared by the admin digest and the public digest -- subject line, signature, and layout look the
              same for both audiences. The admin digest always includes every item it's allowed to; the
              public digest is always prayer-requests-only.
            </p>
            <label>
              Layout
              <select
                value={settings.digestTemplate || "classic"}
                onChange={(e) => setSettings((s) => ({ ...s, digestTemplate: e.target.value }))}
                style={{ width: "auto" }}
              >
                <option value="classic">Classic -- text only</option>
                <option value="snapshot">Snapshot -- adds each partner's photo, field, and overview</option>
              </select>
            </label>
            <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
              Snapshot shows each partner's photo (or a generic silhouette if they don't have one, or if
              they're a restricted-access partner), field, "Supporting since" year, and short overview above
              their items -- for both the admin digest and the public digest.
            </p>
            <label style={{ marginTop: "1rem" }}>
              Subject line
              <input
                value={settings.digestSubjectTemplate || ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, digestSubjectTemplate: e.target.value || null }))
                }
                placeholder="e.g. Your {cadence} Update -- {month} {year}"
              />
            </label>
            <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
              Leave blank for the default: <code>{"{date} {church} - {term} Updates"}</code> -- e.g. "November
              4, 2026 Hillside Community Church - Missionary Updates". Use any of these anywhere in your own
              wording: <code>{"{church}"}</code>, <code>{"{month}"}</code>, <code>{"{year}"}</code>,{" "}
              <code>{"{date}"}</code>, <code>{"{cadence}"}</code> (Biweekly/Monthly/Quarterly),{" "}
              <code>{"{name}"}</code> (the recipient's own name), <code>{"{term}"}</code> (your Partner
              Terminology setting, e.g. "Missionary").
            </p>
            <label style={{ marginTop: "1rem" }}>
              Signature
              <textarea
                rows={3}
                value={settings.digestSignature || ""}
                onChange={(e) => setSettings((s) => ({ ...s, digestSignature: e.target.value || null }))}
                placeholder="An optional closing line -- a verse, a closing phrase, 'Questions? Contact us', etc."
              />
            </label>
          </div>
        )}

        {enabledFeatures.outboundEmail && (
          <div className="admin-section" style={{ marginTop: "1rem" }}>
            <h3>Email Schedule</h3>
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              The cadence each admin (from their own <a href="/admin/account">Account Settings</a>) and each
              public subscriber (from the Subscribe page or a partner's own "follow this partner" form) picks
              for themselves. Nothing sends on a given tier until its schedule here is actually set.
            </p>
            <label>
              Day of week (biweekly)
              <select
                value={settings.scopedDigestDayOfWeek ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    scopedDigestDayOfWeek: e.target.value === "" ? null : Number(e.target.value),
                  }))
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
                value={settings.scopedDigestDayOfMonth ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    scopedDigestDayOfMonth: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                style={{ width: "auto" }}
              >
                <option value="">Not set -- these tiers won't send</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="scoped-digest-hour" style={{ marginTop: "1rem" }}>
              Time (shared by all three tiers)
              <HourSelect
                id="scoped-digest-hour"
                value={settings.scopedDigestHour}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    scopedDigestHour: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
        )}

        {enabledFeatures.groupme && (
          <div className="admin-section" style={{ marginTop: "1rem" }}>
            <h3>GroupMe</h3>
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              A single daily batch time, not a weekly/monthly tier -- GroupMe is a near-real-time, chat-style
              channel, so posts are collected and sent once a day rather than on a longer email-style
              schedule.
            </p>
            <label htmlFor="groupme-digest-hour">
              Time
              <HourSelect
                id="groupme-digest-hour"
                value={settings.groupmeDigestHour}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    groupmeDigestHour: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
            </label>

            <p style={{ margin: "1.25rem 0 0.5rem", color: "#555", fontSize: "0.9rem" }}>
              Mute any content type you don't want posted to GroupMe -- unlike the email digests, which always
              include everything they're allowed to, GroupMe benefits from finer control since it's a live
              chat, not a periodic email.
            </p>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.notifyGroupMePrayerRequests}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, notifyGroupMePrayerRequests: e.target.checked }))
                  }
                />
                Prayer Requests
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.notifyGroupMeOneTimeNeeds}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, notifyGroupMeOneTimeNeeds: e.target.checked }))
                  }
                />
                One-Time Needs
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.notifyGroupMeNewsletters}
                  onChange={(e) => setSettings((s) => ({ ...s, notifyGroupMeNewsletters: e.target.checked }))}
                />
                Newsletters
              </label>
            </div>
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
