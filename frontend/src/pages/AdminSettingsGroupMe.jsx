import React, { useEffect, useState } from "react";
import { fetchGroupMeSettings, updateGroupMeSettings, createGroupMeGroup } from "../api/client.js";

// Phase 1 of the GroupMe integration: Prayer Requests only (see the
// plan this shipped under). GroupMe's public API has no "Topics"
// concept to route to -- everything posts into one group's main
// conversation, as the admin's own GroupMe identity (the Messages API,
// not a named bot). One-Time Needs and Newsletters, and any per-category
// routing, are future phases, not this page.
//
// The access token is write-only by design, same as a password field:
// the backend never returns a stored value, only whether one exists
// (`configured`). Typing a new one and saving replaces it; leaving the
// field blank on save leaves the existing token untouched.
export default function AdminSettingsGroupMe() {
  const [configured, setConfigured] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupId, setGroupId] = useState(null);
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState(null);

  useEffect(() => {
    fetchGroupMeSettings()
      .then((s) => {
        setConfigured(s.configured);
        setGroupName(s.groupName || "");
        setGroupId(s.groupId);
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
      if (accessToken.trim()) payload.accessToken = accessToken.trim();
      const updated = await updateGroupMeSettings(payload);
      setConfigured(updated.configured);
      setGroupName(updated.groupName || "");
      setGroupId(updated.groupId);
      // Never left sitting in the field once it's saved -- same
      // "clears after submit" behavior a browser's own password manager
      // relies on, and this is the one chance to not keep a secret in
      // React state longer than it has to be.
      setAccessToken("");
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save GroupMe settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateGroup() {
    setCreating(true);
    setSuccess("");
    setError("");
    setShareUrl(null);
    try {
      const result = await createGroupMeGroup();
      setGroupId(result.groupId);
      setShareUrl(result.shareUrl);
      setSuccess("GroupMe group created.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't create the GroupMe group.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>GroupMe</h2>
      <p style={{ color: "#555" }}>
        Posts new prayer requests to a GroupMe group as they're added, using your own GroupMe account (not a
        separate bot). Find your personal access token at{" "}
        <a href="https://dev.groupme.com" target="_blank" rel="noreferrer">
          dev.groupme.com
        </a>
        . Turn this on in <a href="/admin/settings/features">Enabled Features</a> once it's configured below.
      </p>

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>Connection</h3>
          <label>
            Access Token
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={configured ? "Configured — leave blank to keep it" : "Paste your access token"}
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
          {success && !shareUrl && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>

      <div className="admin-section">
        <h3>GroupMe Group</h3>
        {groupId ? (
          <>
            <p style={{ color: "#555" }}>Connected to GroupMe group ID {groupId}.</p>
            {shareUrl && (
              <p>
                Share link:{" "}
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  {shareUrl}
                </a>
              </p>
            )}
          </>
        ) : (
          <p style={{ color: "#555" }}>
            No GroupMe group created yet. Save a token and group name above, then create it.
          </p>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={handleCreateGroup}
          disabled={creating || !configured || !groupName.trim()}
        >
          {creating ? "Creating..." : groupId ? "Create a New Group" : "Create GroupMe Group"}
        </button>
      </div>
    </div>
  );
}
