import React, { useState } from "react";

// A section of the partner page that can be edited in place.
//
// The partner record used to be edited through one ~1,000-line form holding
// every field at once, which meant scrolling past fifteen sections to fix a
// typo and re-submitting the whole record to do it. Each section now saves
// only its own fields: PUT /api/partners/:id is a partial update, so a body
// of { overview } touches `overview` and nothing else.
//
// Usage:
//   <EditableSection
//     title="Ministry Overview"
//     value={{ overview: p.overview }}
//     onSave={(draft) => updatePartner(p.id, draft)}
//     view={(v) => <Field label="Overview" value={v.overview} />}
//     edit={(draft, set) => <textarea value={draft.overview} onChange={e => set("overview", e.target.value)} />}
//   />
//
// `onSave` receives the draft and should return a promise. Whatever it
// resolves to is ignored -- the parent reloads the record afterwards via
// `onSaved`, so the page always reflects what the server actually stored
// rather than what the form believed it sent.
export default function EditableSection({ title, value, onSave, onSaved, view, edit, actions = null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    setDraft(value);
    setError("");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError("");
  }

  function set(field, next) {
    setDraft((d) => ({ ...d, [field]: next }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setEditing(false);
      await onSaved?.();
    } catch (err) {
      setError(
        err.response?.data?.error?.[0]?.message || err.response?.data?.error || "Failed to save changes"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>{title}</h3>
        <div className="table-actions">
          {actions}
          {editing ? (
            <>
              <button type="button" className="btn small" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn secondary small" onClick={cancel} disabled={saving}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn secondary small" onClick={startEdit}>
              Edit
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>{editing ? edit(draft, set, setDraft) : view(value)}</div>

      {error && <p style={{ color: "#b91c1c", marginTop: "0.75rem" }}>{error}</p>}
    </div>
  );
}
