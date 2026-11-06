import React, { useEffect, useState } from "react";
import { fetchNotificationSettings, updateNotificationSettings } from "../api/client.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

// Settings governing the notification queue -- schedule, what joins it,
// and the email digest's own appearance. Split out from the actual
// queue (see AdminPendingNotifications.jsx) since these are admin-only
// site config, same "settings vs. content" split Email already has
// between its settings page and Unmatched Emails.
export default function AdminNotificationSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchNotificationSettings()
      .then(setSettings)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load notification settings."))
      .finally(() => setLoading(false));
  }, []);

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
        How new prayer requests, one-time needs, and newsletters get batched and sent to GroupMe and/or email.
        To review or send what's currently queued, see the <strong>Pending Notifications</strong> page in the
        main menu.
      </p>

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>Schedule</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Automatically send whatever's queued on this cadence. Leave as "No automatic schedule" to only
            send manually from Pending Notifications.
          </p>
          <label>
            Frequency
            <select
              value={settings.digestFrequency || ""}
              onChange={(e) => setSettings((s) => ({ ...s, digestFrequency: e.target.value || null }))}
              style={{ width: "auto" }}
            >
              <option value="">No automatic schedule</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          {settings.digestFrequency && settings.digestFrequency !== "monthly" && (
            <label style={{ marginTop: "1rem" }}>
              Day
              <select
                value={settings.digestDayOfWeek ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, digestDayOfWeek: Number(e.target.value) }))}
                style={{ width: "auto" }}
              >
                <option value="" disabled>
                  Choose a day
                </option>
                {DAY_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {settings.digestFrequency === "monthly" && (
            <label style={{ marginTop: "1rem" }}>
              Day of month
              <select
                value={settings.digestDayOfMonth ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, digestDayOfMonth: Number(e.target.value) }))}
                style={{ width: "auto" }}
              >
                <option value="" disabled>
                  Choose a day
                </option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}

          {settings.digestFrequency && (
            <label style={{ marginTop: "1rem" }}>
              Time
              <select
                value={settings.digestHour ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, digestHour: Number(e.target.value) }))}
                style={{ width: "auto" }}
              >
                <option value="" disabled>
                  Choose a time
                </option>
                {Array.from({ length: 24 }, (_, h) => h).map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="admin-section" style={{ marginTop: "1rem" }}>
          <h3>Prayer Digest Schedule</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            A separate schedule for the scoped prayer digest (#202) -- the weekly/biweekly/monthly cadence
            each admin picks for themselves on their own <a href="/admin/account">Account Settings</a> page,
            and each public subscriber picks when they follow a partner or use the Subscribe page. All three cadence
            tiers run on this one schedule, not the schedule above (which only governs GroupMe and the
            original church-wide email batch) -- weekly and biweekly share the same day of week, and fire for
            whichever subscribers picked that specific cadence.
          </p>
          <label>
            Day of week (weekly & biweekly)
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
              <option value="">Not set -- these tiers won't send</option>
              {DAY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ marginTop: "1rem" }}>
            Day of month (monthly)
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
              <option value="">Not set -- this tier won't send</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label style={{ marginTop: "1rem" }}>
            Time (shared by all three)
            <select
              value={settings.scopedDigestHour ?? ""}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  scopedDigestHour: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              style={{ width: "auto" }}
            >
              <option value="">Not set</option>
              {Array.from({ length: 24 }, (_, h) => h).map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-section" style={{ marginTop: "1rem" }}>
          <h3>What queues for notification</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Turn off anything you don't want notified about at all -- it never joins the queue for either
            channel.
          </p>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={settings.queueNotifyPrayerRequests}
                onChange={(e) => setSettings((s) => ({ ...s, queueNotifyPrayerRequests: e.target.checked }))}
              />
              Prayer Requests
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.queueNotifyOneTimeNeeds}
                onChange={(e) => setSettings((s) => ({ ...s, queueNotifyOneTimeNeeds: e.target.checked }))}
              />
              One-Time Needs
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.queueNotifyNewsletters}
                onChange={(e) => setSettings((s) => ({ ...s, queueNotifyNewsletters: e.target.checked }))}
              />
              Newsletters
            </label>
          </div>
          <p style={{ margin: "0.75rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            This last one is a filter across the three above, not a peer type of its own.
          </p>
          <div className="admin-checkbox-row" style={{ marginTop: "0.35rem" }}>
            <label>
              <input
                type="checkbox"
                checked={settings.queueNotifyRestrictedPartners}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, queueNotifyRestrictedPartners: e.target.checked }))
                }
              />
              Restricted partners
            </label>
          </div>
          <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            Off skips restricted-access partners' events entirely -- nothing is queued for them, which also
            means nothing ever needs manual review. On (default) queues them like anyone else, subject to the
            review requirement on the Pending Notifications page.
          </p>
        </div>

        <div className="admin-section" style={{ marginTop: "1rem" }}>
          <h3>Digest Customization</h3>
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
            Snapshot shows each partner's photo (or a generic silhouette if they don't have one, or if they're
            a restricted-access partner), field, "Supporting since" year, and short overview above their items
            in that batch.
          </p>
          <label style={{ marginTop: "1rem" }}>
            Subject line
            <input
              value={settings.digestSubjectTemplate || ""}
              onChange={(e) => setSettings((s) => ({ ...s, digestSubjectTemplate: e.target.value || null }))}
              placeholder="e.g. Your {frequency} Update -- {month} {year}"
            />
          </label>
          <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            Leave blank for the default: <code>{"{date} {church} - {term} Updates"}</code> -- e.g. "November
            4, 2026 Hillside Community Church - Missionary Updates". Use any of these anywhere in your own
            wording: <code>{"{church}"}</code>, <code>{"{month}"}</code>, <code>{"{year}"}</code>,{" "}
            <code>{"{date}"}</code>, <code>{"{frequency}"}</code> (Weekly/Biweekly/Monthly),{" "}
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
