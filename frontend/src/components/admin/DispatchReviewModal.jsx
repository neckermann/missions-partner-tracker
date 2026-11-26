import React, { useEffect, useState } from "react";
import Modal from "../Modal.jsx";
import { revealPendingDispatch, updatePendingDispatch } from "../../api/client.js";
import ApproveRestrictedTextConfirmBody from "./ApproveRestrictedTextConfirmBody.jsx";
import ApproveCareTeamTextConfirmBody from "./ApproveCareTeamTextConfirmBody.jsx";

// Shows the real (unmasked) text behind a queued dispatch and lets an admin edit it before it
// sends. For a restricted row still `needsReview`, saving clears it to send
// (dispatchEligibility.js needsReview()). `blurb` is the row from the pending list (needs `id`,
// `isRestricted`, `needsReview`); the real text is fetched on mount, not taken from the masked
// `bodyText`.
export default function DispatchReviewModal({ blurb, onSaved, onClose }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Confirming swaps this modal's body in place instead of opening a second Modal: two Modals each
  // register a document-level Escape listener and Escape would close both.
  const [confirmingApproval, setConfirmingApproval] = useState(false);

  useEffect(() => {
    revealPendingDispatch(blurb.id)
      .then((result) => {
        setText(result.rawText || "");
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to load the text of this update");
        setStatus("error");
      });
  }, [blurb.id]);

  async function handleSave() {
    if (!text.trim()) {
      setError("Enter some text before saving");
      return;
    }
    // Saving a held restricted row clears it to send, so it gets the same confirm gate and exact-text
    // framing as the row's Approve button.
    if (blurb.needsReview && !confirmingApproval) {
      setConfirmingApproval(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updatePendingDispatch(blurb.id, text.trim());
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit update" onClose={onClose}>
      {status === "loading" && <p style={{ color: "var(--muted)" }}>Loading...</p>}
      {status === "error" && (
        <p style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}

      {status === "ready" && confirmingApproval && (
        <>
          {blurb.reviewRequired && !blurb.isRestricted ? (
            <ApproveCareTeamTextConfirmBody text={text.trim()} />
          ) : (
            <ApproveRestrictedTextConfirmBody text={text.trim()} />
          )}

          {error && (
            <p style={{ color: "var(--danger)" }} role="alert">
              {error}
            </p>
          )}

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn small" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save and Approve"}
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setConfirmingApproval(false)}
              disabled={saving}
            >
              Back
            </button>
          </div>
        </>
      )}

      {status === "ready" && !confirmingApproval && (
        <>
          {blurb.isRestricted ? (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              This partner is restricted -- their name, photo, and any link back to the source file stay
              masked no matter what. Review the text below for anything else that could identify them or their
              location before saving.
              {blurb.needsReview && " Saving is what clears this to send -- it won't go out until you do."}
            </p>
          ) : blurb.reviewRequired && blurb.needsReview ? (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              A care team member entered this, so it hasn't gone out. Edit the text if it needs it, then save
              -- saving is what clears it to send.
            </p>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Edit the text that will go out.</p>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            style={{ width: "100%" }}
            disabled={saving}
          />

          {error && (
            <p style={{ color: "var(--danger)" }} role="alert">
              {error}
            </p>
          )}

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn small" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : blurb.needsReview ? "Save and Approve" : "Save"}
            </button>
            <button type="button" className="btn secondary small" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
