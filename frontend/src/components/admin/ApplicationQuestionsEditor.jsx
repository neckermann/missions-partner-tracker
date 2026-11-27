import React, { useState } from "react";

// Shared editor for an application-question list: a trip's own questions, the church-wide template
// and the question library. Fully controlled: `onAdd`/`onUpdate`/`onRemove` get the new intent and
// the caller decides when to persist.
const QUESTION_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Multiple choice (pick one)" },
  { value: "checkboxes", label: "Checkboxes (pick any)" },
  { value: "date", label: "Date" },
];

// One choice per line, not comma-separated: a comma-joined line can't round-trip a choice that
// contains a comma ("No, but I can apply in time").
function optionsToText(options) {
  return (options || []).join("\n");
}
function textToOptions(text) {
  return text
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}
function needsOptionsFor(type) {
  return type === "select" || type === "checkboxes";
}

// Move-up/move-down rather than drag-and-drop: the lists are short and the app has no dnd dependency.
function moveItem(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

// One "Answer choices" field shared by the editor and the add-a-question forms.
function OptionsField({ defaultValue, value, onChange, onBlur }) {
  return (
    <label style={{ display: "block", marginTop: "0.6rem", fontWeight: 400, fontSize: "0.85rem" }}>
      Answer choices
      <textarea
        rows={3}
        style={{ width: "100%", marginTop: "0.2rem", fontFamily: "inherit" }}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={"One per line, e.g.\nYes\nNo"}
      />
      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.15rem" }}>
        One choice per line -- a choice can safely contain its own comma this way.
      </span>
    </label>
  );
}

export default function ApplicationQuestionsEditor({
  questions,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  library,
  onAddFromLibrary,
}) {
  const [draft, setDraft] = useState({ label: "", required: false, type: "text", optionsText: "" });
  const [libraryPick, setLibraryPick] = useState("");

  function resetDraft() {
    setDraft({ label: "", required: false, type: "text", optionsText: "" });
  }

  function handleMove(index, delta) {
    if (!onReorder) return;
    const reordered = moveItem(questions, index, delta);
    if (reordered !== questions) onReorder(reordered);
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!draft.label.trim()) return;
    const needsOptions = needsOptionsFor(draft.type);
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
        {questions.map((q, index) => {
          const type = q.type || "text";
          const typeLabel = QUESTION_TYPES.find((t) => t.value === type)?.label || type;
          return (
            <li
              key={q.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.7rem 0.8rem",
                marginBottom: "0.6rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <span
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    paddingTop: "1.6rem",
                  }}
                >
                  {index + 1}.
                </span>
                <label style={{ flex: 1, fontWeight: 400, fontSize: "0.85rem" }}>
                  Question text
                  <input
                    style={{ width: "100%", marginTop: "0.2rem" }}
                    defaultValue={q.label}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== q.label &&
                      onUpdate(q.id, { label: e.target.value.trim() })
                    }
                  />
                </label>
                {onReorder && (
                  <div style={{ display: "flex", flexDirection: "column", marginTop: "1.5rem" }}>
                    <button
                      type="button"
                      className="btn-remove"
                      title="Move up"
                      aria-label="Move this question up"
                      disabled={index === 0}
                      style={{ opacity: index === 0 ? 0.3 : 1 }}
                      onClick={() => handleMove(index, -1)}
                    >
                      ▲ Up
                    </button>
                    <button
                      type="button"
                      className="btn-remove"
                      title="Move down"
                      aria-label="Move this question down"
                      disabled={index === questions.length - 1}
                      style={{ opacity: index === questions.length - 1 ? 0.3 : 1 }}
                      onClick={() => handleMove(index, 1)}
                    >
                      ▼ Down
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="btn-remove"
                  title="Remove this question"
                  aria-label="Remove this question"
                  style={{ marginTop: "1.5rem" }}
                  onClick={() => onRemove(q.id)}
                >
                  Remove
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1rem",
                  marginTop: "0.6rem",
                  paddingLeft: "1.4rem",
                }}
              >
                <label style={{ fontWeight: 400, fontSize: "0.85rem" }}>
                  Question type
                  <select
                    style={{ display: "block", marginTop: "0.2rem" }}
                    value={type}
                    onChange={(e) =>
                      onUpdate(q.id, {
                        type: e.target.value,
                        options: needsOptionsFor(e.target.value) ? q.options || [] : undefined,
                      })
                    }
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontWeight: 400,
                    fontSize: "0.85rem",
                    marginTop: "1.3rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!q.required}
                    onChange={(e) => onUpdate(q.id, { required: e.target.checked })}
                  />
                  Required -- applicant must answer before submitting
                </label>
              </div>

              {needsOptionsFor(type) && (
                <div style={{ paddingLeft: "1.4rem" }}>
                  <OptionsField
                    defaultValue={optionsToText(q.options)}
                    onBlur={(e) => onUpdate(q.id, { options: textToOptions(e.target.value) })}
                  />
                </div>
              )}

              <p
                style={{
                  margin: "0.5rem 0 0",
                  paddingLeft: "1.4rem",
                  color: "var(--muted)",
                  fontSize: "0.78rem",
                }}
              >
                Shown as a "{typeLabel}" question{q.required ? ", required" : ", optional"}.
              </p>
            </li>
          );
        })}
        {questions.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No questions yet -- add one below.</p>
        )}
      </ul>

      {library && library.length > 0 && (
        <div className="admin-section" style={{ marginBottom: "0.75rem" }}>
          <h4 style={{ margin: "0 0 0.3rem" }}>Add from your saved questions</h4>
          <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
            Reuse a question you've already saved instead of retyping it.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select style={{ flex: 1 }} value={libraryPick} onChange={(e) => setLibraryPick(e.target.value)}>
              <option value="">Choose a saved question...</option>
              {library.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn secondary small"
              onClick={handleAddFromLibrary}
              disabled={!libraryPick}
            >
              + Add to this list
            </button>
          </div>
        </div>
      )}

      <div className="admin-section">
        <h4 style={{ margin: "0 0 0.3rem" }}>Add a new question</h4>
        <form onSubmit={handleAdd}>
          <label style={{ display: "block", fontWeight: 400, fontSize: "0.85rem" }}>
            Question text
            <input
              style={{ width: "100%", marginTop: "0.2rem" }}
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="e.g. Do you have a valid passport?"
            />
          </label>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.6rem" }}>
            <label style={{ fontWeight: 400, fontSize: "0.85rem" }}>
              Question type
              <select
                style={{ display: "block", marginTop: "0.2rem" }}
                value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontWeight: 400,
                fontSize: "0.85rem",
                marginTop: "1.3rem",
              }}
            >
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))}
              />
              Required -- applicant must answer before submitting
            </label>
          </div>

          {needsOptionsFor(draft.type) && (
            <OptionsField
              value={draft.optionsText}
              onChange={(e) => setDraft((d) => ({ ...d, optionsText: e.target.value }))}
            />
          )}

          <button type="submit" className="btn secondary small" style={{ marginTop: "0.75rem" }}>
            + Add question
          </button>
        </form>
      </div>
    </div>
  );
}
