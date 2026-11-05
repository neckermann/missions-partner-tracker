import React, { useEffect, useState } from "react";
import {
  fetchNotificationSettings,
  updateNotificationSettings,
  fetchPendingNotifications,
  sendPendingNotifications,
  deletePendingNotification,
} from "../api/client.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

// Groups blurbs by partner, nesting a request/need under the newsletter
// blurb it was sourced from -- same structure utils/emailDigest.js
// renders, so this preview matches what actually goes out. Duplicated
// here rather than shared with the backend since it's purely a display
// concern, not a contract either side depends on the other to honor.
function groupByPartner(blurbs) {
  const byPartner = new Map();
  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, {
        partnerName: blurb.partnerName,
        // Uniform across every blurb from the same partner -- grabbed
        // off whichever blurb happens to create the group.
        isRestricted: blurb.isRestricted,
        newsletters: [],
        standalone: [],
      });
    }
    if (blurb.type === "newsletterCreated") {
      byPartner.get(blurb.partnerId).newsletters.push({ blurb, children: [] });
    }
  }
  for (const blurb of blurbs) {
    if (blurb.type === "newsletterCreated") continue;
    const group = byPartner.get(blurb.partnerId);
    const parent = blurb.sourceFileId
      ? group.newsletters.find((n) => n.blurb.newsletterId === blurb.sourceFileId)
      : null;
    if (parent) parent.children.push(blurb);
    else group.standalone.push(blurb);
  }
  return [...byPartner.values()];
}

function SentStatus({ blurb }) {
  const parts = [];
  if (blurb.groupmeSentAt) parts.push("GroupMe ✓");
  if (blurb.emailSentAt) parts.push("Email ✓");
  if (parts.length === 0) return null;
  return (
    <span style={{ color: "#888", fontSize: "0.8rem", marginLeft: "0.5rem" }}>({parts.join(", ")})</span>
  );
}

// Amber, not this app's own red/danger color -- "restricted" isn't an
// error state, it's a heads-up that this row's content is already masked
// and should stay that way (no copy-pasting the real details into
// GroupMe/email by hand, no assuming the summary is the full story).
const RESTRICTED_BORDER = "#b45309";
const RESTRICTED_BG = "#fffbeb";

function RestrictedBadge() {
  return (
    <span
      style={{
        marginLeft: "0.5rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        background: RESTRICTED_BORDER,
        color: "#fff",
        fontSize: "0.75rem",
        fontWeight: 600,
        verticalAlign: "middle",
      }}
    >
      🔒 Restricted
    </span>
  );
}

function BlurbRow({ blurb, onClear, clearing }) {
  return (
    <div
      style={{
        margin: "0.5rem 0 0.5rem 1rem",
        paddingLeft: "0.75rem",
        borderLeft: `3px solid ${blurb.isRestricted ? RESTRICTED_BORDER : "#e5e5e5"}`,
        background: blurb.isRestricted ? RESTRICTED_BG : "transparent",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "0.75rem",
      }}
    >
      <div>
        <strong>
          {blurb.emoji} {blurb.summary}
        </strong>
        <SentStatus blurb={blurb} />
        <p style={{ margin: "0.25rem 0 0", color: "#555" }}>{blurb.bodyText}</p>
        {blurb.amount && <p style={{ margin: "0.25rem 0 0", fontWeight: 600 }}>Approved: {blurb.amount}</p>}
      </div>
      {onClear && (
        <button
          type="button"
          className="btn secondary small"
          onClick={() => onClear(blurb.id)}
          disabled={clearing}
          style={{ flexShrink: 0 }}
        >
          {clearing ? "Clearing..." : "Clear"}
        </button>
      )}
    </div>
  );
}

export default function AdminPendingNotifications() {
  const [settings, setSettings] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearingId, setClearingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function reloadPending() {
    return fetchPendingNotifications().then(setPending);
  }

  useEffect(() => {
    Promise.all([fetchNotificationSettings().then(setSettings), reloadPending()])
      .catch((err) => setError(err.response?.data?.error || "Couldn't load notification settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateNotificationSettings(settings);
      setSettings(updated);
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save notification settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSendNow() {
    setSending(true);
    setError("");
    setSuccess("");
    try {
      const result = await sendPendingNotifications();
      await reloadPending();
      setSuccess(
        result.sent > 0
          ? `Sent ${result.sent} notification${result.sent === 1 ? "" : "s"}.${
              result.remaining > 0
                ? ` ${result.remaining} still queued (a channel's send didn't succeed).`
                : ""
            }`
          : "Nothing went out -- check that a channel is actually configured, or there's nothing queued."
      );
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send pending notifications.");
    } finally {
      setSending(false);
    }
  }

  // Discards one queued item for good -- works on any row, not just a
  // restricted one. No confirm dialog: same as every other delete in
  // this admin, a mis-click just means it's gone (it was never sent
  // anywhere, so there's nothing downstream to also undo).
  async function handleClear(id) {
    setClearingId(id);
    setError("");
    setSuccess("");
    try {
      await deletePendingNotification(id);
      await reloadPending();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't clear that notification.");
    } finally {
      setClearingId(null);
    }
  }

  if (loading || !settings) return <p className="admin-shell">Loading…</p>;

  const groups = groupByPartner(pending);

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Notifications</h2>
      <p style={{ color: "#555" }}>
        New prayer requests, one-time needs, and newsletters queue here instead of posting immediately --
        review and send them as a batch, on a schedule or on demand.
      </p>

      <form onSubmit={handleSaveSettings} className="admin-form">
        <div className="admin-section">
          <h3>Schedule</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Automatically send whatever's queued on this cadence. Leave as "No automatic schedule" to only
            send manually, below.
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
          <button type="submit" className="btn" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save"}
          </button>
          {error && (
            <span style={{ color: "#b91c1c" }} role="alert">
              {error}
            </span>
          )}
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>

      <div className="admin-section" style={{ marginTop: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Pending ({pending.length})</h3>
          <button
            type="button"
            className="btn"
            onClick={handleSendNow}
            disabled={sending || pending.length === 0}
          >
            {sending ? "Sending..." : "Send Pending Notifications Now"}
          </button>
        </div>

        {groups.length === 0 && <p style={{ color: "#888" }}>Nothing waiting to go out.</p>}

        {groups.map((group) => (
          <div
            key={group.partnerName}
            style={{ marginTop: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e5e5e5" }}
          >
            <strong>{group.partnerName}</strong>
            {group.isRestricted && <RestrictedBadge />}
            {group.newsletters.map(({ blurb, children }) => (
              <div key={blurb.id}>
                <BlurbRow blurb={blurb} onClear={handleClear} clearing={clearingId === blurb.id} />
                {children.map((child) => (
                  <div key={child.id} style={{ marginLeft: "1.5rem" }}>
                    <BlurbRow blurb={child} onClear={handleClear} clearing={clearingId === child.id} />
                  </div>
                ))}
              </div>
            ))}
            {group.standalone.map((blurb) => (
              <BlurbRow
                key={blurb.id}
                blurb={blurb}
                onClear={handleClear}
                clearing={clearingId === blurb.id}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
