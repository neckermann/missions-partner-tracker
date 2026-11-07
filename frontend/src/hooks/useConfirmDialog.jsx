import React, { useCallback, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";

// A styled, accessible stand-in for window.confirm()/prompt(), built on
// Modal.jsx -- the app's one confirmation pattern (CONTRIBUTING.md §
// Code style bans new window.confirm()/prompt() calls). `await
// confirm({...})` resolves to true/false like window.confirm, so callers
// keep their control flow; `body` is JSX instead of a string so it can
// lay out more than one flat line of text.
//
// `typedConfirmation: { word, label }` adds a stricter gate for a
// genuinely irreversible action (e.g. permanently deleting a partner) --
// Confirm stays disabled until the typed value matches `word`,
// case/whitespace-insensitive.
export default function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState("");
  const resolverRef = useRef(null);

  const confirm = useCallback(
    ({
      title,
      body,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      danger = false,
      maxWidth,
      typedConfirmation,
    }) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setTypedValue("");
        setDialog({ title, body, confirmLabel, cancelLabel, danger, maxWidth, typedConfirmation });
      }),
    []
  );

  function settle(result) {
    setDialog(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }

  const typedConfirmation = dialog?.typedConfirmation;
  const typedMismatch =
    typedConfirmation && typedValue.trim().toLowerCase() !== typedConfirmation.word.toLowerCase();

  const confirmElement = dialog ? (
    <Modal title={dialog.title} onClose={() => settle(false)} maxWidth={dialog.maxWidth}>
      {dialog.body}
      {typedConfirmation && (
        <label style={{ display: "block", marginTop: "1rem" }}>
          {typedConfirmation.label}
          <input
            type="text"
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            autoFocus
            style={{ display: "block", marginTop: "0.35rem", width: "100%" }}
          />
        </label>
      )}
      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={`btn small${dialog.danger ? " danger" : ""}`}
          onClick={() => settle(true)}
          disabled={typedMismatch}
        >
          {dialog.confirmLabel}
        </button>
        <button type="button" className="btn secondary small" onClick={() => settle(false)}>
          {dialog.cancelLabel}
        </button>
      </div>
    </Modal>
  ) : null;

  return { confirm, confirmElement };
}
