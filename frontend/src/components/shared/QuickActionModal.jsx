import React, { useState } from "react";
import Modal from "../Modal.jsx";

// Common chrome for quick add/update actions from a Partner Detail summary card: error display,
// "Saved ✓" confirmation, submit-button states. `onSubmit` does the API call (and may show further
// confirmations, e.g. useUrgentApprovalGate); nothing resource-specific lives here. `onDelete` (an
// existing record only) adds a Delete button: it does its own confirmation and resolves true once the
// record is gone, which closes the popup. `savedNote`, when given, is shown with "Saved ✓" and keeps the
// popup open a little longer so it can be read (e.g. "it has gone to the missions team for review").
export default function QuickActionModal({
  title,
  onClose,
  onSubmit,
  children,
  submitLabel = "Save",
  submitDisabled = false,
  maxWidth,
  onDelete,
  savedNote,
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (justSaved) return;
    setError("");
    setSaving(true);
    try {
      const proceeded = await onSubmit();
      if (proceeded === false) {
        // A nested confirmation (e.g. "Send now?") was declined: leave the form open as the user left it.
        return;
      }
      setJustSaved(true);
      setTimeout(onClose, savedNote ? 3000 : 900);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError("");
    setSaving(true);
    try {
      if ((await onDelete()) === true) onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} maxWidth={maxWidth}>
      <form onSubmit={handleSubmit}>
        {children}
        {error && <p style={{ color: "var(--danger)", marginTop: "0.75rem" }}>{error}</p>}
        {justSaved && !error && (
          <p style={{ color: "var(--brand-color-safe, #2a5d3c)", marginTop: "0.75rem" }} role="status">
            Saved ✓{savedNote ? ` ${savedNote}` : ""}
          </p>
        )}
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="submit" className="btn" disabled={saving || justSaved || submitDisabled}>
            {saving ? "Saving…" : justSaved ? "Saved ✓" : submitLabel}
          </button>
          {onDelete && (
            <button
              type="button"
              className="btn danger"
              disabled={saving || justSaved}
              onClick={handleDelete}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
