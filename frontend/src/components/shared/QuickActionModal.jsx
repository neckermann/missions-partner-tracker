import React, { useState } from "react";
import Modal from "../Modal.jsx";

// One consistent chrome for every quick add/update action launched from a
// Partner Detail summary card: same error display, same "Saved ✓"
// confirmation as EditableSection.jsx uses, same submit-button states.
// `onSubmit` does the actual API call (and may itself show further
// confirmations, e.g. useUrgentApprovalGate) -- this component only owns
// the saving/error/justSaved chrome around it, not any resource-specific
// logic.
export default function QuickActionModal({
  title,
  onClose,
  onSubmit,
  children,
  submitLabel = "Save",
  submitDisabled = false,
  maxWidth,
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
        // A nested confirmation (e.g. "Send now?") was declined -- leave
        // the form open exactly as the user left it, no error, no close.
        return;
      }
      setJustSaved(true);
      setTimeout(onClose, 900);
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
        {error && <p style={{ color: "#b91c1c", marginTop: "0.75rem" }}>{error}</p>}
        {justSaved && !error && <p style={{ color: "#2a5d3c", marginTop: "0.75rem" }}>Saved ✓</p>}
        <div style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn" disabled={saving || justSaved || submitDisabled}>
            {saving ? "Saving…" : justSaved ? "Saved ✓" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
