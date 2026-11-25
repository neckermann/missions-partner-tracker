import React, { useCallback, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";

// A styled stand-in for window.confirm()/prompt() on Modal.jsx; the app's one confirmation
// pattern (CONTRIBUTING.md § Code style). `await confirm({...})` resolves true/false; `body` is JSX.
// `typedConfirmation: { word, label }` keeps Confirm disabled until the typed value matches `word`
// (case/whitespace-insensitive), for irreversible actions.
// `textInput: { label, placeholder?, rows? }` collects free text and resolves `{ confirmed, text }`
// instead of a boolean. The hook owns that input because `dialog.body` is a snapshot, so a
// controlled input inside the caller's `body` would freeze.
export default function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState("");
  const [textInputValue, setTextInputValue] = useState("");
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
      textInput,
    }) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setTypedValue("");
        setTextInputValue("");
        setDialog({ title, body, confirmLabel, cancelLabel, danger, maxWidth, typedConfirmation, textInput });
      }),
    []
  );

  function settle(confirmed) {
    const hadTextInput = !!dialog?.textInput;
    const text = textInputValue.trim();
    setDialog(null);
    resolverRef.current?.(hadTextInput ? { confirmed, text: confirmed ? text : "" } : confirmed);
    resolverRef.current = null;
  }

  const typedConfirmation = dialog?.typedConfirmation;
  const typedMismatch =
    typedConfirmation && typedValue.trim().toLowerCase() !== typedConfirmation.word.toLowerCase();
  const textInput = dialog?.textInput;

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
      {textInput && (
        <label style={{ display: "block", marginTop: "1rem" }}>
          {textInput.label}
          <textarea
            rows={textInput.rows || 2}
            placeholder={textInput.placeholder}
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
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
