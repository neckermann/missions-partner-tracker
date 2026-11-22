import React, { useState } from "react";
import Modal from "../Modal.jsx";
import useUnsavedChangesGuard from "../../hooks/useUnsavedChangesGuard.js";
import { mapServerErrorMessage } from "../../utils/friendlyError.js";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";

// A section of the partner page that can be edited via a popup.
//
// The partner record used to be edited through one ~1,000-line form holding
// every field at once, which meant scrolling past fifteen sections to fix a
// typo and re-submitting the whole record to do it. Each section now saves
// only its own fields: PUT /api/partners/:id is a partial update, so a body
// of { overview } touches `overview` and nothing else.
//
// The whole card is the click target -- same convention as a Table row --
// opening a popup with the edit form (or, when `canEdit` is false, the same
// read-only view content in a plain Modal). This used to swap the view for
// an inline edit form directly on the page; that's exactly the
// no-explicit-boundary shape that made onBlur-autosave's silent-failure bug
// possible elsewhere, so every section now has a hard open/close boundary
// instead.
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
export default function EditableSection({
  title,
  value,
  onSave,
  onSaved,
  view,
  edit,
  actions = null,
  canEdit = true,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const hasUnsavedChanges = open && canEdit && JSON.stringify(draft) !== JSON.stringify(value);
  useUnsavedChangesGuard(hasUnsavedChanges);

  function openSection() {
    setDraft(value);
    setError("");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError("");
  }

  function set(field, next) {
    setDraft((d) => ({ ...d, [field]: next }));
  }

  async function save(e) {
    e?.preventDefault?.();
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setOpen(false);
      await onSaved?.();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err) {
      setError(mapServerErrorMessage(err.response?.data?.error) || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="admin-section admin-section-clickable"
        role="button"
        tabIndex={0}
        onClick={onClickUnlessSelecting(openSection)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openSection();
          }
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ flex: 1, marginBottom: 0 }}>{title}</h3>
          {actions && (
            <div className="table-actions" onClick={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
        </div>
        <div style={{ marginTop: "1rem" }}>{view(value)}</div>
        {justSaved && !error && <p style={{ color: "#2a5d3c", marginTop: "0.75rem" }}>Saved ✓</p>}
      </div>

      {open && canEdit && (
        <Modal title={title} onClose={close}>
          <form onSubmit={save}>
            {edit(draft, set, setDraft)}
            {error && (
              <p className="form-error" role="alert" style={{ marginTop: "0.75rem" }}>
                {error}
              </p>
            )}
            <div className="table-actions" style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn small" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn secondary small" onClick={close} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {open && !canEdit && (
        <Modal title={title} onClose={close}>
          {view(value)}
        </Modal>
      )}
    </>
  );
}
