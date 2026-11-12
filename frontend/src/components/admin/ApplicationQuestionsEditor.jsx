import React, { useState } from "react";

// Shared editor for an application-question list -- used for a trip's own
// applicationQuestions (AdminTripDetail.jsx), the church-wide
// tripApplicationTemplate, and the tripQuestionLibrary picker source
// (both AdminSettingsTrips.jsx). One component so all three stay in sync
// as the question shape evolves, instead of three hand-copied UIs.
//
// Fully controlled: the parent owns persistence. `onAdd`/`onUpdate`/
// `onRemove` are called with the new full intent; what happens next
// (save immediately, or just update local form state until a page-level
// Save button is clicked) is entirely up to the caller.
const QUESTION_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Multiple choice (pick one)" },
  { value: "checkboxes", label: "Checkboxes (pick any)" },
];

function optionsToText(options) {
  return (options || []).join(", ");
}
function textToOptions(text) {
  return text
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export default function ApplicationQuestionsEditor({ questions, onAdd, onUpdate, onRemove, library, onAddFromLibrary }) {
  const [draft, setDraft] = useState({ label: "", required: false, type: "text", optionsText: "" });
  const [libraryPick, setLibraryPick] = useState("");

  function resetDraft() {
    setDraft({ label: "", required: false, type: "text", optionsText: "" });
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!draft.label.trim()) return;
    const needsOptions = draft.type === "select" || draft.type === "checkboxes";
    const options = needsOptions ? textToOptions(draft.optionsText) : undefined;
    if (needsOptions && options.length === 0) return;
    onAdd({ label: draft.label.trim(), required: draft.required, type: draft.type, options });
    resetDraft();
  }

  function handleAddFromLibrary() {
    if (!libraryPick) return;
    const entry = (library || []).find((q) => q.id === libraryPick);
    if (entry) onAddFromLibrary(entry);
    setLibraryPick("");
  }

  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {questions.map((q) => {
          const type = q.type || "text";
          const needsOptions = type === "select" || type === "checkboxes";
          return (
            <li key={q.id} style={{ border: "1px solid #e1dfdb", borderRadius: 6, padding: "0.5rem 0.6rem", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  style={{ flex: 1 }}
                  defaultValue={q.label}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== q.label && onUpdate(q.id, { label: e.target.value.trim() })}
                />
                <select value={type} onChange={(e) => onUpdate(q.id, { type: e.target.value, options: e.target.value === "select" || e.target.value === "checkboxes" ? q.options || [] : undefined })}>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontWeight: 400, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={!!q.required} onChange={(e) => onUpdate(q.id, { required: e.target.checked })} />
                  Required
                </label>
                <button type="button" className="btn-remove" onClick={() => onRemove(q.id)}>
                  ✕
                </button>
              </div>
              {needsOptions && (
                <input
                  style={{ marginTop: "0.4rem", width: "100%" }}
                  defaultValue={optionsToText(q.options)}
                  placeholder="Options, comma-separated (e.g. Yes, No)"
                  onBlur={(e) => onUpdate(q.id, { options: textToOptions(e.target.value) })}
                />
              )}
            </li>
          );
        })}
        {questions.length === 0 && <p style={{ color: "#888" }}>No questions yet.</p>}
      </ul>

      {library && library.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <select value={libraryPick} onChange={(e) => setLibraryPick(e.target.value)}>
            <option value="">Add from saved questions...</option>
            {library.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn secondary small" onClick={handleAddFromLibrary} disabled={!libraryPick}>
            + Add
          </button>
        </div>
      )}

      <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input
          style={{ flex: 1, minWidth: 220 }}
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="e.g. Do you have a valid passport?"
        />
        <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
          {QUESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {(draft.type === "select" || draft.type === "checkboxes") && (
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={draft.optionsText}
            onChange={(e) => setDraft((d) => ({ ...d, optionsText: e.target.value }))}
            placeholder="Options, comma-separated (e.g. Yes, No)"
          />
        )}
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontWeight: 400 }}>
          <input type="checkbox" checked={draft.required} onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))} />
          Required
        </label>
        <button type="submit" className="btn secondary small">
          + Add
        </button>
      </form>
    </div>
  );
}
