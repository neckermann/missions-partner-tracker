import React, { useState } from "react";
import Modal from "../Modal.jsx";
import useUnsavedChangesGuard from "../../hooks/useUnsavedChangesGuard.js";
import { mapServerErrorMessage } from "../../utils/friendlyError.js";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";

// A partner-page section edited in a popup (a plain Modal view when `canEdit` is false). The whole
// card is the click target, like a Table row. Each section saves only its own fields: PUT
// /api/partners/:id is a partial update. `onSave(draft)` returns a promise whose result is
// ignored; the parent reloads via `onSaved` so the page shows what the server stored.
//   <EditableSection title value={{ overview }} onSave={(d) => ...} view={(v) => ...}
//     edit={(draft, set) => ...} />
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
          {/* A phone has no hover cue, so say the card opens for editing. Decorative: the card is already a
              button, and its whole body is the click target. */}
          {canEdit && (
            <span
              className="editable-hint"
              aria-hidden="true"
              style={{ color: "var(--muted)", fontSize: "0.85rem", marginRight: actions ? "0.75rem" : 0 }}
            >
              Edit
            </span>
          )}
          {actions && (
            // Not interactive itself: stops clicks/keydowns on the inner buttons bubbling to the card handler.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              className="table-actions"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
        </div>
        <div style={{ marginTop: "1rem" }}>{view(value)}</div>
        {justSaved && !error && (
          <p style={{ color: "var(--brand-color-safe, #2a5d3c)", marginTop: "0.75rem" }}>Saved ✓</p>
        )}
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
