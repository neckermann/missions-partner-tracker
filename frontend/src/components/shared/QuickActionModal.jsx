import React, { useState } from "react";
import Modal from "../Modal.jsx";

// Common chrome for quick add/update actions from a Partner Detail summary card: error display,
// "Saved ✓" confirmation, submit-button states. `onSubmit` does the API call (and may show further
// confirmations, e.g. useUrgentApprovalGate); nothing resource-specific lives here.
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
        // A nested confirmation (e.g. "Send now?") was declined: leave the form open as the user left it.
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
        {error && <p style={{ color: "var(--danger)", marginTop: "0.75rem" }}>{error}</p>}
        {justSaved && !error && (
          <p style={{ color: "var(--brand-color-safe, #2a5d3c)", marginTop: "0.75rem" }}>Saved ✓</p>
        )}
        <div style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn" disabled={saving || justSaved || submitDisabled}>
            {saving ? "Saving…" : justSaved ? "Saved ✓" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
