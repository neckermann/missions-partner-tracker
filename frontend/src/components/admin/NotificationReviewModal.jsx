import React, { useEffect, useState } from "react";
import Modal from "../Modal.jsx";
import { revealPendingNotification, updatePendingNotification } from "../../api/client.js";
import ApproveRestrictedTextConfirmBody from "./ApproveRestrictedTextConfirmBody.jsx";

// Lets an admin see the real (unmasked) text behind a queued
// notification and edit it before it sends (#187) -- available on any
// row, not just a restricted partner's. For a restricted row that's
// still `needsReview`, saving here is what clears it to send (see
// notificationFlush.js's own needsReview()); for everything else it's
// purely a content edit with no effect on whether/when it sends.
//
// `blurb` is the row object as already loaded in AdminPendingNotifications.jsx's
// `pending` list (needs at least `id`, `isRestricted`, `needsReview`) --
// the real text itself is fetched fresh on mount via
// revealPendingNotification rather than trusting the already-masked
// `bodyText` the list carries.
export default function NotificationReviewModal({ blurb, onSaved, onClose }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Confirming the exact text swaps this modal's own body in place,
  // rather than opening a second Modal on top of this one -- two Modal
  // instances would both register their own document-level Escape
  // listener, and neither's stopPropagation() stops the other's handler
  // from also firing (they're both listeners on the same document
  // target), so Escape would close both at once. One dialog, two steps,
  // is correct here even though the other three approve flows (which
  // aren't already inside a Modal) use the shared useConfirmDialog hook.
  const [confirmingApproval, setConfirmingApproval] = useState(false);

  useEffect(() => {
    revealPendingNotification(blurb.id)
      .then((result) => {
        setText(result.rawText || "");
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to load this notification's text");
        setStatus("error");
      });
  }, [blurb.id]);

  async function handleSave() {
    if (!text.trim()) {
      setError("Enter some text before saving");
      return;
    }
    // Same real-world consequence as the row's own "Approve" button --
    // for a held restricted row, saving here is what clears it to send,
    // so it gets the same confirm gate and the same "here's the exact
    // text" framing, even though it's already visible above -- the
    // confirm step should stand on its own as the final checkpoint.
    if (blurb.needsReview && !confirmingApproval) {
      setConfirmingApproval(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updatePendingNotification(blurb.id, text.trim());
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit notification" onClose={onClose}>
      {status === "loading" && <p style={{ color: "#555" }}>Loading...</p>}
      {status === "error" && (
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      )}

      {status === "ready" && confirmingApproval && (
        <>
          <ApproveRestrictedTextConfirmBody text={text.trim()} />

          {error && (
            <p style={{ color: "#b91c1c" }} role="alert">
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
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              This partner is restricted -- their name, photo, and any link back to the source file stay
              masked no matter what. Review the text below for anything else that could identify them or their
              location before saving.
              {blurb.needsReview && " Saving is what clears this to send -- it won't go out until you do."}
            </p>
          ) : (
            <p style={{ color: "#555", fontSize: "0.9rem" }}>Edit the text that will go out.</p>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            style={{ width: "100%" }}
            disabled={saving}
          />

          {error && (
            <p style={{ color: "#b91c1c" }} role="alert">
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
