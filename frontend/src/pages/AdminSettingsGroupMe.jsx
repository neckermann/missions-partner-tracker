import React, { useEffect, useState } from "react";
import { fetchGroupMeSettings, updateGroupMeSettings } from "../api/client.js";

// Phase 1 of the GroupMe integration: Prayer Requests only. Posts
// through a GroupMe Bot -- the admin creates the group and the bot
// themselves directly in GroupMe, then pastes the bot's ID here. This
// app never talks to GroupMe's group/bot-creation endpoints, only
// /bots/post. GroupMe's public API has no "Topics" concept to route to,
// so everything posts into the bot's one group's main conversation.
// One-Time Needs, Newsletters, and per-category routing are future
// phases, not this page.
//
// The bot ID is write-only by design, same as a password field: the
// backend never returns a stored value, only whether one exists
// (`configured`). Pasting a new one and saving replaces it; leaving the
// field blank on save leaves the existing bot untouched.
export default function AdminSettingsGroupMe() {
  const [configured, setConfigured] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [botId, setBotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGroupMeSettings()
      .then((s) => {
        setConfigured(s.configured);
        setGroupName(s.groupName || "");
      })
      .catch((err) => setError(err.response?.data?.error || "Couldn't load GroupMe settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const payload = { groupName };
      if (botId.trim()) payload.botId = botId.trim();
      const updated = await updateGroupMeSettings(payload);
      setConfigured(updated.configured);
      setGroupName(updated.groupName || "");
      // Never left sitting in the field once it's saved -- same
      // "clears after submit" behavior a browser's own password manager
      // relies on, and this is the one chance to not keep a secret in
      // React state longer than it has to be.
      setBotId("");
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save GroupMe settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>GroupMe</h2>
      <p style={{ color: "#555" }}>
        Posts new prayer requests to a GroupMe group as they're added, through a GroupMe Bot. Turn this on in{" "}
        <a href="/admin/settings/features">Enabled Features</a> once it's configured below.
      </p>

      <div className="admin-section">
        <h3>Setup</h3>
        <ol style={{ color: "#555", paddingLeft: "1.2rem", margin: 0 }}>
          <li>Create (or pick an existing) group in the GroupMe app.</li>
          <li>
            Go to{" "}
            <a href="https://dev.groupme.com/bots" target="_blank" rel="noreferrer">
              dev.groupme.com/bots
            </a>{" "}
            and create a new bot, pointed at that group.
          </li>
          <li>Copy the Bot ID it gives you and paste it below.</li>
        </ol>
      </div>

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>Connection</h3>
          <label>
            Bot ID
            <input
              type="password"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              placeholder={configured ? "Configured — leave blank to keep it" : "Paste the bot's ID"}
              autoComplete="off"
            />
          </label>
          <label>
            Group Name
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Missions Prayer Requests"
            />
            <span style={{ fontSize: "0.85rem", color: "#666" }}>
              Your own label for which group this is — not sent to GroupMe.
            </span>
          </label>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>
    </div>
  );
}
