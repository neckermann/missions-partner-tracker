import React, { useEffect, useState } from "react";
import EditableSection from "./EditableSection.jsx";

export default function ApiKeySettingsPage({
  title,
  description,
  instructions,
  loadErrorMessage,
  saveErrorMessage,
  fetchSettings,
  updateSettings,
}) {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchSettings()
      .then((s) => setConfigured(s.configured))
      .catch((err) => setLoadError(err.response?.data?.error || loadErrorMessage))
      .finally(() => setLoading(false));
    // fetchSettings/loadErrorMessage come from the caller's own module-level
    // imports/string literals, never recreated on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(draft) {
    if (!draft.apiKey?.trim()) return;
    let updated;
    try {
      updated = await updateSettings({ apiKey: draft.apiKey.trim() });
    } catch (err) {
      throw new Error(err.response?.data?.error || saveErrorMessage);
    }
    setConfigured(updated.configured);
  }

  if (loading) return <p>Loading…</p>;
  if (loadError) {
    return (
      <p className="form-error" role="alert">
        {loadError}
      </p>
    );
  }

  return (
    <EditableSection
      title={title}
      value={{ apiKey: "" }}
      onSave={save}
      view={() => (
        <>
          <p style={{ color: "#555" }}>{description}</p>
          <p>{configured ? "Configured" : "Not configured"}</p>
        </>
      )}
      edit={(d, set) => (
        <>
          <p style={{ color: "#555" }}>{description}</p>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>{instructions}</p>
          <label>
            API Key
            <input
              type="password"
              value={d.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={configured ? "Configured — leave blank to keep it" : "Paste your API key"}
              autoComplete="off"
            />
          </label>
        </>
      )}
    />
  );
}
