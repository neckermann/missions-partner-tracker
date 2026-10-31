import React, { useEffect, useState } from "react";
import {
  fetchGroupMeSettings,
  updateGroupMeSettings,
  fetchGroupMeGroups,
  fetchGroupMeTopics,
} from "../api/client.js";

// Phase 1 of the GroupMe integration: Prayer Requests only. Posts as
// the admin's own GroupMe identity (the Messages API, not a bot --
// GroupMe's Bots API has no awareness of Topics at all). Topics are
// undocumented in GroupMe's public API but real: each one is a
// "subgroup" with its own id, and the ordinary messages endpoint posts
// into it when pointed at that id instead of the parent group's -- see
// backend/src/utils/groupme.js for the detail. One-Time Needs,
// Newsletters, and their own topic mappings are future phases, not this
// page.
//
// The access token is write-only by design, same as a password field:
// the backend never returns a stored value, only whether one exists
// (`configured`). Pasting a new one and saving replaces it; leaving the
// field blank on save leaves the existing token untouched. The group
// and topic are never hand-typed -- both come from live GroupMe API
// calls, picked from a dropdown.
export default function AdminSettingsGroupMe() {
  const [configured, setConfigured] = useState(false);
  const [groupId, setGroupId] = useState(null);
  const [groupName, setGroupName] = useState(null);
  const [prayerTopicId, setPrayerTopicId] = useState(null);
  const [prayerTopicName, setPrayerTopicName] = useState(null);
  const [accessToken, setAccessToken] = useState("");

  const [groups, setGroups] = useState(null);
  const [topics, setTopics] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  function applySettings(s) {
    setConfigured(s.configured);
    setGroupId(s.groupId);
    setGroupName(s.groupName);
    setPrayerTopicId(s.prayerTopicId);
    setPrayerTopicName(s.prayerTopicName);
  }

  useEffect(() => {
    fetchGroupMeSettings()
      .then(applySettings)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load GroupMe settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveToken(e) {
    e.preventDefault();
    if (!accessToken.trim()) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateGroupMeSettings({ accessToken: accessToken.trim() });
      applySettings(updated);
      setAccessToken("");
      setSuccess("Token saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the access token.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadGroups() {
    setLoadingGroups(true);
    setSuccess("");
    setError("");
    try {
      const list = await fetchGroupMeGroups();
      setGroups(list);
      setSelectedGroupId(groupId || list[0]?.id || "");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load your GroupMe groups.");
    } finally {
      setLoadingGroups(false);
    }
  }

  async function handleSaveGroup() {
    const picked = groups?.find((g) => g.id === selectedGroupId);
    if (!picked) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateGroupMeSettings({ groupId: picked.id, groupName: picked.name });
      applySettings(updated);
      setTopics(null);
      setSuccess("Group saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the group.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadTopics() {
    if (!groupId) return;
    setLoadingTopics(true);
    setSuccess("");
    setError("");
    try {
      const list = await fetchGroupMeTopics(groupId);
      setTopics(list);
      setSelectedTopicId(prayerTopicId || list[0]?.id || "");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load that group's topics.");
    } finally {
      setLoadingTopics(false);
    }
  }

  async function handleSaveTopic() {
    const picked = topics?.find((t) => t.id === selectedTopicId);
    if (!picked) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateGroupMeSettings({
        prayerTopicId: picked.id,
        prayerTopicName: picked.name,
      });
      applySettings(updated);
      setSuccess("Prayer Requests topic saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the topic.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>GroupMe</h2>
      <p style={{ color: "#555" }}>
        Posts new prayer requests to a GroupMe Topic as they're added. Turn this on in{" "}
        <a href="/admin/settings/features">Enabled Features</a> once it's configured below.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSaveToken} className="admin-form">
        <div className="admin-section">
          <h3>1. Access Token</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Get a personal access token at{" "}
            <a href="https://dev.groupme.com" target="_blank" rel="noreferrer">
              dev.groupme.com
            </a>
            . Messages post under your own GroupMe account.
          </p>
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
          <button type="submit" className="btn" disabled={saving || !accessToken.trim()}>
            {saving ? "Saving..." : "Save Token"}
          </button>
        </div>
      </form>

      <div className="admin-section">
        <h3>2. Group</h3>
        {groupName ? (
          <p style={{ color: "#555" }}>Currently: {groupName}</p>
        ) : (
          <p style={{ color: "#555" }}>No group selected yet.</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={handleLoadGroups}
            disabled={!configured || loadingGroups}
          >
            {loadingGroups ? "Loading..." : "Load My Groups"}
          </button>
          {groups && (
            <>
              <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={handleSaveGroup}
                disabled={saving || !selectedGroupId}
              >
                Use This Group
              </button>
            </>
          )}
        </div>
      </div>

      <div className="admin-section">
        <h3>3. Prayer Requests Topic</h3>
        {prayerTopicName ? (
          <p style={{ color: "#555" }}>Currently: {prayerTopicName}</p>
        ) : (
          <p style={{ color: "#555" }}>
            No topic selected yet — until one is, prayer requests post to the group's main conversation.
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={handleLoadTopics}
            disabled={!groupId || loadingTopics}
          >
            {loadingTopics ? "Loading..." : "Load Topics"}
          </button>
          {topics && (
            <>
              <select value={selectedTopicId} onChange={(e) => setSelectedTopicId(e.target.value)}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={handleSaveTopic}
                disabled={saving || !selectedTopicId}
              >
                Use This Topic
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
