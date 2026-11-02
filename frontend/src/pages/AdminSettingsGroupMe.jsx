import React, { useEffect, useState } from "react";
import {
  fetchGroupMeSettings,
  updateGroupMeSettings,
  fetchGroupMeGroups,
  fetchGroupMeTopics,
} from "../api/client.js";

// Posts as the admin's own GroupMe identity (the Messages API, not a bot
// -- GroupMe's Bots API has no awareness of Topics at all). Topics are
// undocumented in GroupMe's public API but real: each one is a
// "subgroup" with its own id, and the ordinary messages endpoint posts
// into it when pointed at that id instead of the parent group's -- see
// backend/src/utils/groupme.js for the detail.
//
// The access token is write-only by design, same as a password field:
// the backend never returns a stored value, only whether one exists
// (`configured`). Pasting a new one and saving replaces it; leaving the
// field blank on save leaves the existing token untouched. The group and
// each topic are never hand-typed -- both come from live GroupMe API
// calls, picked from a dropdown.
//
// Three notification types, three topics, but one group and one topic
// list -- GroupMe's own API has no notion of "list topics for this
// notification type," only "list a group's topics," so Load Topics is
// shared and each section below just has its own picker + save button
// against that same list.
const TOPIC_TYPES = [
  {
    number: 3,
    key: "prayer",
    title: "Prayer Requests Topic",
    idField: "prayerTopicId",
    nameField: "prayerTopicName",
    fallbackNote: "prayer requests post to the group's main conversation",
  },
  {
    number: 4,
    key: "oneTimeNeed",
    title: "One-Time Needs Topic",
    idField: "oneTimeNeedTopicId",
    nameField: "oneTimeNeedTopicName",
    fallbackNote: "one-time needs post to the group's main conversation",
  },
  {
    number: 5,
    key: "newsletter",
    title: "Newsletters Topic",
    idField: "newsletterTopicId",
    nameField: "newsletterTopicName",
    fallbackNote: "newsletters post to the group's main conversation",
  },
];

function TopicSection({ type, settings, groupId, topics, saving, onSave }) {
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const currentTopicName = settings[type.nameField];

  useEffect(() => {
    if (topics) setSelectedTopicId(settings[type.idField] || topics[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics]);

  return (
    <div className="admin-section">
      <h3>
        {type.number}. {type.title}
      </h3>
      {currentTopicName ? (
        <p style={{ color: "#555" }}>Currently: {currentTopicName}</p>
      ) : (
        <p style={{ color: "#555" }}>No topic selected yet — until one is, {type.fallbackNote}.</p>
      )}
      {topics && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
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
            onClick={() => {
              const picked = topics.find((t) => t.id === selectedTopicId);
              if (picked) onSave(type, picked);
            }}
            disabled={saving || !selectedTopicId}
          >
            Use This Topic
          </button>
        </div>
      )}
      {!topics && !groupId && <p style={{ color: "#888", fontSize: "0.9rem" }}>Pick a group first.</p>}
    </div>
  );
}

export default function AdminSettingsGroupMe() {
  const [settings, setSettings] = useState({
    configured: false,
    groupId: null,
    groupName: null,
    prayerTopicId: null,
    prayerTopicName: null,
    oneTimeNeedTopicId: null,
    oneTimeNeedTopicName: null,
    newsletterTopicId: null,
    newsletterTopicName: null,
  });
  const [accessToken, setAccessToken] = useState("");

  const [groups, setGroups] = useState(null);
  const [topics, setTopics] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGroupMeSettings()
      .then(setSettings)
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
      setSettings(updated);
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
      setSelectedGroupId(settings.groupId || list[0]?.id || "");
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
      setSettings(updated);
      setTopics(null);
      setSuccess("Group saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the group.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadTopics() {
    if (!settings.groupId) return;
    setLoadingTopics(true);
    setSuccess("");
    setError("");
    try {
      setTopics(await fetchGroupMeTopics(settings.groupId));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load that group's topics.");
    } finally {
      setLoadingTopics(false);
    }
  }

  async function handleSaveTopic(type, picked) {
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateGroupMeSettings({
        [type.idField]: picked.id,
        [type.nameField]: picked.name,
      });
      setSettings(updated);
      setSuccess(`${type.title} saved.`);
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
        Posts new prayer requests, one-time needs, and newsletters to GroupMe Topics as they're added. Turn
        this on in <a href="/admin/settings/features">Enabled Features</a> once it's configured below.
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
              placeholder={
                settings.configured ? "Configured — leave blank to keep it" : "Paste your access token"
              }
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
        {settings.groupName ? (
          <p style={{ color: "#555" }}>Currently: {settings.groupName}</p>
        ) : (
          <p style={{ color: "#555" }}>No group selected yet.</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={handleLoadGroups}
            disabled={!settings.configured || loadingGroups}
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
        <h3>Topics</h3>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          One list of topics for the group above, shared by the three pickers below — load it once, then pick
          a topic for each notification type you want.
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={handleLoadTopics}
          disabled={!settings.groupId || loadingTopics}
        >
          {loadingTopics ? "Loading..." : "Load Topics"}
        </button>
      </div>

      {TOPIC_TYPES.map((type) => (
        <TopicSection
          key={type.key}
          type={type}
          settings={settings}
          groupId={settings.groupId}
          topics={topics}
          saving={saving}
          onSave={handleSaveTopic}
        />
      ))}
    </div>
  );
}
