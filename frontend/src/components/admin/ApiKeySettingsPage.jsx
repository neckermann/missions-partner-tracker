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
  // Optional: one extra plain-text, non-secret field { key, label, placeholder, helpText } shown
  // beside the write-only key. Unlike apiKey, its value is echoed back and editable as plain text.
  textField,
}) {
  const [configured, setConfigured] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setConfigured(s.configured);
        if (textField) setTextValue(s[textField.key] ?? "");
      })
      .catch((err) => setLoadError(err.response?.data?.error || loadErrorMessage))
      .finally(() => setLoading(false));
    // fetchSettings/loadErrorMessage/textField are module-level or literals, never recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(draft) {
    // Built conditionally so rotating the API key doesn't require retyping (or blanking) the model, and vice versa.
    const payload = {};
    if (draft.apiKey?.trim()) payload.apiKey = draft.apiKey.trim();
    if (textField) payload[textField.key] = draft[textField.key]?.trim() || null;
    if (Object.keys(payload).length === 0) return;

    let updated;
    try {
      updated = await updateSettings(payload);
    } catch (err) {
      throw new Error(err.response?.data?.error || saveErrorMessage);
    }
    setConfigured(updated.configured);
    if (textField) setTextValue(updated[textField.key] ?? "");
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
      value={{ apiKey: "", ...(textField ? { [textField.key]: textValue } : {}) }}
      onSave={save}
      view={() => (
        <>
          <p style={{ color: "var(--muted)" }}>{description}</p>
          <p>{configured ? "Configured" : "Not configured"}</p>
          {textField && (
            <p>
              {textField.label}: {textValue || "App default"}
            </p>
          )}
        </>
      )}
      edit={(d, set) => (
        <>
          <p style={{ color: "var(--muted)" }}>{description}</p>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{instructions}</p>
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
          {textField && (
            <label style={{ display: "block", marginTop: "0.75rem" }}>
              {textField.label}
              <input
                type="text"
                value={d[textField.key] ?? ""}
                onChange={(e) => set(textField.key, e.target.value)}
                placeholder={textField.placeholder}
              />
              {textField.helpText && (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", fontWeight: "normal" }}>
                  {textField.helpText}
                </p>
              )}
            </label>
          )}
        </>
      )}
    />
  );
}
